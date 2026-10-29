use crate::{fits_f64, fits_i64, read_fits_value, FitsHeader};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FitsAnalysis {
    pub width: usize,
    pub height: usize,
    pub valid_samples: usize,
    pub excluded_samples: usize,
    pub mean: Option<f64>,
    pub median: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub std_dev: Option<f64>,
    pub nonpositive_percent: Option<f64>,
    pub saturation_limit: Option<f64>,
    pub saturation_source: Option<String>,
    pub saturation_percent: Option<f64>,
    pub histogram: Vec<u64>,
}

pub fn analyze(
    data: &[u8],
    header: &FitsHeader,
    width: usize,
    height: usize,
) -> Result<FitsAnalysis, String> {
    let bitpix = fits_i64(&header.cards, "BITPIX")?;
    let bytes_per_sample = match bitpix {
        8 => 1,
        16 => 2,
        32 | -32 => 4,
        -64 => 8,
        _ => return Err("Unsupported FITS BITPIX".into()),
    };
    let count = width
        .checked_mul(height)
        .ok_or("FITS dimensions overflow")?;
    let required = count
        .checked_mul(bytes_per_sample)
        .ok_or("FITS data size overflow")?;
    if count == 0 || data.len() < required {
        return Err("FITS data ended unexpectedly".into());
    }
    let scale = fits_f64(&header.cards, "BSCALE", 1.0);
    let zero = fits_f64(&header.cards, "BZERO", 0.0);
    if !scale.is_finite() || !zero.is_finite() || scale == 0.0 {
        return Err("Invalid FITS scaling".into());
    }
    let blank = if bitpix > 0 {
        fits_i64(&header.cards, "BLANK").ok().map(|v| v as f64)
    } else {
        None
    };
    let header_limit = header
        .cards
        .get("SATURATE")
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite());
    let file_limit = match bitpix {
        8 => Some((0.0_f64, 255.0_f64)),
        16 => Some((i16::MIN as f64, i16::MAX as f64)),
        32 => Some((i32::MIN as f64, i32::MAX as f64)),
        _ => None,
    }
    .map(|(lo, hi)| (lo * scale + zero).max(hi * scale + zero))
    .filter(|v| v.is_finite());
    let limit = header_limit.or(file_limit);
    let mut result = FitsAnalysis {
        width,
        height,
        valid_samples: 0,
        excluded_samples: 0,
        mean: None,
        median: None,
        min: None,
        max: None,
        std_dev: None,
        nonpositive_percent: None,
        saturation_limit: limit,
        saturation_source: limit.map(|_| {
            if header_limit.is_some() {
                "SATURATE"
            } else {
                "file ceiling"
            }
            .into()
        }),
        saturation_percent: None,
        histogram: vec![0; 256],
    };
    let mut values = Vec::with_capacity(count);
    let (mut mean, mut m2) = (0.0, 0.0);
    let (mut nonpositive, mut saturated) = (0usize, 0usize);
    for index in 0..count {
        let raw = read_fits_value(data, bitpix, index, 0.0, 1.0)?;
        let value = raw * scale + zero;
        if blank == Some(raw) || !value.is_finite() {
            result.excluded_samples += 1;
            continue;
        }
        values.push(value);
        let delta = value - mean;
        mean += delta / values.len() as f64;
        m2 += delta * (value - mean);
        if value <= 0.0 {
            nonpositive += 1;
        }
        if limit.is_some_and(|threshold| value >= threshold) {
            saturated += 1;
        }
    }
    result.valid_samples = values.len();
    if values.is_empty() {
        return Ok(result);
    }
    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if !mean.is_finite() || !m2.is_finite() || !(max - min).is_finite() {
        return Err("FITS values exceed analysis numeric range".into());
    }
    for &value in &values {
        let bin = if max > min {
            (((value - min) / (max - min) * 256.0) as usize).min(255)
        } else {
            0
        };
        result.histogram[bin] += 1;
    }
    // Selection gives an exact median without sorting the whole sensor image.
    let middle = values.len() / 2;
    values.select_nth_unstable_by(middle, f64::total_cmp);
    let median = if values.len() % 2 == 0 {
        values[..middle]
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max)
            / 2.0
            + values[middle] / 2.0
    } else {
        values[middle]
    };
    result.mean = Some(mean);
    result.median = Some(median);
    result.min = Some(min);
    result.max = Some(max);
    result.std_dev = Some((m2 / values.len() as f64).max(0.0).sqrt());
    result.nonpositive_percent = Some(nonpositive as f64 * 100.0 / values.len() as f64);
    result.saturation_percent = limit.map(|_| saturated as f64 * 100.0 / values.len() as f64);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn header(pairs: &[(&str, &str)]) -> FitsHeader {
        FitsHeader {
            cards: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            data_offset: 0,
        }
    }
    #[test]
    fn exact_unsigned_statistics_and_ceiling() {
        let data: Vec<u8> = [i16::MIN, -32758, -32748, i16::MAX]
            .iter()
            .flat_map(|v| v.to_be_bytes())
            .collect();
        let result = analyze(
            &data,
            &header(&[("BITPIX", "16"), ("BZERO", "32768")]),
            4,
            1,
        )
        .unwrap();
        assert_eq!(result.median, Some(15.0));
        assert_eq!(result.mean, Some(16391.25));
        assert_eq!(result.nonpositive_percent, Some(25.0));
        assert_eq!(result.saturation_percent, Some(25.0));
        assert_eq!(result.histogram.iter().sum::<u64>(), 4);
    }
    #[test]
    fn floating_invalid_samples_and_no_assumed_saturation() {
        let data: Vec<u8> = [1.0_f32, 2.0, 3.0, f32::NAN, f32::INFINITY]
            .iter()
            .flat_map(|v| v.to_be_bytes())
            .collect();
        let result = analyze(&data, &header(&[("BITPIX", "-32")]), 5, 1).unwrap();
        assert_eq!(result.median, Some(2.0));
        assert!((result.std_dev.unwrap() - (2.0_f64 / 3.0).sqrt()).abs() < 1e-10);
        assert_eq!(result.excluded_samples, 2);
        assert_eq!(result.saturation_percent, None);
    }
    #[test]
    fn blank_negative_scale_and_explicit_saturation() {
        let result = analyze(
            &[0, 1, 2, 255],
            &header(&[
                ("BITPIX", "8"),
                ("BSCALE", "-2"),
                ("BZERO", "10"),
                ("BLANK", "255"),
                ("SATURATE", "8"),
            ]),
            4,
            1,
        )
        .unwrap();
        assert_eq!(result.median, Some(8.0));
        assert_eq!(result.min, Some(6.0));
        assert_eq!(result.excluded_samples, 1);
        assert_eq!(result.saturation_source.as_deref(), Some("SATURATE"));
        assert!((result.saturation_percent.unwrap() - 200.0 / 3.0).abs() < 1e-10);
    }
    #[test]
    fn constant_and_all_blank_are_well_defined() {
        let result = analyze(&[7, 7, 7], &header(&[("BITPIX", "8")]), 3, 1).unwrap();
        assert_eq!(result.std_dev, Some(0.0));
        assert_eq!(result.histogram[0], 3);
        let empty = analyze(&[7, 7], &header(&[("BITPIX", "8"), ("BLANK", "7")]), 2, 1).unwrap();
        assert_eq!(empty.mean, None);
        assert_eq!(empty.valid_samples, 0);
    }
    #[test]
    fn truncated_or_overflowing_images_fail() {
        let h = header(&[("BITPIX", "16")]);
        assert!(analyze(&[0], &h, 1, 1).is_err());
        assert!(analyze(&[], &h, usize::MAX, 2).is_err());
    }
}
