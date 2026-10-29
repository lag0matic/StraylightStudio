use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::ipc::Channel;
use tokio::{sync::mpsc, time::timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Deserialize)]
pub struct HttpRequest {
    url: String,
    method: String,
    body: Option<String>,
    timeout_ms: u64,
}

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    content_type: String,
    body_base64: String,
}

fn validate_url(value: &str, websocket: bool) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid server address")?;
    let allowed = if websocket {
        ["ws", "wss"]
    } else {
        ["http", "https"]
    };
    if !allowed.contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Server address must use HTTP/HTTPS (WS/WSS for events), without credentials or a fragment".into());
    }
    Ok(url)
}

fn initialize_tls() {
    static TLS: std::sync::Once = std::sync::Once::new();
    TLS.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

#[tauri::command]
pub async fn network_http(request: HttpRequest) -> Result<HttpResponse, String> {
    initialize_tls();
    let url = validate_url(&request.url, false)?;
    let method = match request.method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => return Err("Unsupported network method".into()),
    };
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .map_err(|error| error.to_string())?;
    let mut call = client
        .request(method, url.clone())
        .timeout(Duration::from_millis(
            request.timeout_ms.clamp(100, 2_200_000),
        ));
    if let Some(body) = request.body {
        call = call
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body);
    }
    let operation = async {
        let mut response = call.send().await?;
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 256 * 1024 * 1024 {
                return Ok::<_, reqwest::Error>(Err("Server response exceeds 256 MiB".to_string()));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Ok(HttpResponse {
            status,
            content_type,
            body_base64: STANDARD.encode(bytes),
        }))
    };
    operation.await.map_err(|error| {
        if error.is_timeout() {
            format!(
                "Timed out waiting for {}. Check the server and network.",
                url.origin().ascii_serialization()
            )
        } else {
            format!(
                "Unable to reach {}: {error}",
                url.origin().ascii_serialization()
            )
        }
    })?
}

#[derive(Clone, Serialize)]
pub struct SocketEvent {
    kind: &'static str,
    data: Option<String>,
}
type SocketCommands = mpsc::Sender<Option<String>>;
static SOCKETS: OnceLock<Mutex<HashMap<String, SocketCommands>>> = OnceLock::new();
fn sockets() -> &'static Mutex<HashMap<String, SocketCommands>> {
    SOCKETS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn socket_session(
    url: &str,
    events: Channel<SocketEvent>,
    mut commands: mpsc::Receiver<Option<String>>,
) -> Result<(), String> {
    initialize_tls();
    let connection = tokio::select! {
        result = timeout(Duration::from_secs(6), connect_async(url)) => result.map_err(|_| "Event connection timed out")?.map_err(|error| error.to_string())?,
        _ = commands.recv() => return Ok(()),
    };
    let (mut socket, _) = connection;
    events
        .send(SocketEvent {
            kind: "open",
            data: None,
        })
        .map_err(|error| error.to_string())?;
    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(Some(text)) => timeout(Duration::from_secs(6), socket.send(Message::Text(text.into()))).await
                    .map_err(|_| "Event send timed out")?.map_err(|error| error.to_string())?,
                _ => { let _ = timeout(Duration::from_secs(2), socket.close(None)).await; break; }
            },
            incoming = socket.next() => match incoming {
                Some(Ok(Message::Text(text))) => events.send(SocketEvent { kind: "message", data: Some(text.to_string()) }).map_err(|error| error.to_string())?,
                Some(Ok(Message::Ping(bytes))) => {
                    timeout(Duration::from_secs(6), socket.send(Message::Pong(bytes))).await
                        .map_err(|_| "Event reply timed out")?.map_err(|error| error.to_string())?;
                },
                Some(Ok(Message::Close(_))) | None => break,
                Some(Err(error)) => return Err(error.to_string()),
                _ => {},
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn http_server(
        response: &'static [u8],
        delay: Duration,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buffer = [0; 1024];
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            std::thread::sleep(delay);
            let _ = stream.write_all(response);
            String::from_utf8_lossy(&bytes).to_string()
        });
        (url, thread)
    }

    #[tokio::test]
    async fn native_http_preserves_status_binary_body_and_query() {
        let (url, server) = http_server(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 4\r\nContent-Type: image/fits\r\nConnection: close\r\n\r\n\x00\x01\xfe\xff", Duration::ZERO);
        let response = network_http(HttpRequest {
            url: format!("{url}/v2/api/equipment/camera/capture?save=true&duration=1"),
            method: "GET".into(),
            body: None,
            timeout_ms: 2000,
        })
        .await
        .unwrap();
        assert_eq!(response.status, 503);
        assert_eq!(response.content_type, "image/fits");
        assert_eq!(
            STANDARD.decode(response.body_base64).unwrap(),
            [0, 1, 254, 255]
        );
        assert!(server
            .join()
            .unwrap()
            .contains("capture?save=true&duration=1"));
    }

    #[tokio::test]
    async fn native_http_does_not_follow_redirected_commands() {
        let (url, server) = http_server(b"HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: http://127.0.0.1:1/move\r\nConnection: close\r\n\r\n", Duration::ZERO);
        let response = network_http(HttpRequest {
            url,
            method: "GET".into(),
            body: None,
            timeout_ms: 2000,
        })
        .await
        .unwrap();
        assert_eq!(response.status, 302);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn native_http_times_out_and_reports_unavailable_server() {
        let (url, server) = http_server(
            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n",
            Duration::from_millis(400),
        );
        let error = network_http(HttpRequest {
            url,
            method: "GET".into(),
            body: None,
            timeout_ms: 100,
        })
        .await
        .err()
        .unwrap();
        assert!(error.contains("Timed out"));
        server.join().unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let error = network_http(HttpRequest {
            url,
            method: "GET".into(),
            body: None,
            timeout_ms: 2000,
        })
        .await
        .err()
        .unwrap();
        assert!(
            error.contains("Unable to reach") || error.contains("Timed out"),
            "{error}"
        );
    }

    #[test]
    fn rejects_non_network_urls_and_embedded_credentials() {
        for url in [
            "file:///C:/secret",
            "http://user:pass@localhost",
            "http://localhost/#fragment",
        ] {
            assert!(validate_url(url, false).is_err());
        }
        assert!(validate_url("ws://localhost:1888/v2/tppa", true).is_ok());
        assert!(validate_url("http://[::1]:1888/v2/api", false).is_ok());
    }
}

#[tauri::command]
pub async fn network_socket(
    id: String,
    url: String,
    events: Channel<SocketEvent>,
) -> Result<(), String> {
    validate_url(&url, true)?;
    let (sender, receiver) = mpsc::channel(16);
    {
        let mut registry = sockets().lock().map_err(|_| "Event registry unavailable")?;
        if registry.contains_key(&id) {
            return Err("Event connection already exists".into());
        }
        registry.insert(id.clone(), sender);
    }
    let result = socket_session(&url, events.clone(), receiver).await;
    sockets()
        .lock()
        .map_err(|_| "Event registry unavailable")?
        .remove(&id);
    if let Err(error) = &result {
        let _ = events.send(SocketEvent {
            kind: "error",
            data: Some(format!("Unable to use event connection {url}: {error}")),
        });
    }
    let _ = events.send(SocketEvent {
        kind: "close",
        data: None,
    });
    result
}

#[tauri::command]
pub async fn network_socket_send(id: String, data: Option<String>) -> Result<(), String> {
    let sender = sockets()
        .lock()
        .map_err(|_| "Event registry unavailable")?
        .get(&id)
        .cloned();
    if let Some(sender) = sender {
        timeout(Duration::from_secs(2), sender.send(data))
            .await
            .map_err(|_| "Event queue timed out")?
            .map_err(|_| "Event connection closed")?;
    } else if data.is_some() {
        return Err("Event connection is not open".into());
    }
    Ok(())
}
