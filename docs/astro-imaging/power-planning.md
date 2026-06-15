# Power Planning

Reliable unattended imaging depends on the power system being boring.

## Voltage Domains

Typical rig voltages:

- Mount: often 12V DC.
- Dew heaters: usually 12V DC.
- Cooled camera: usually 12V DC for cooler power, plus USB data.
- Focuser: often USB or 12V depending on model.
- MiniPC: commonly 19V DC.
- Travel router: often 5V USB-C, 5V micro-USB, 9V, or 12V depending on model.

The miniPC needing 19V means a normal 12V astro battery cannot power it directly.

## Converter Choice

Going from a 12V battery to a 19V miniPC requires a boost converter or a dedicated 12V-to-19V laptop-style DC adapter.

Going from a higher-voltage battery to 12V requires a buck converter.

Avoid using a 120V inverter for the miniPC unless convenience matters more than efficiency. The inefficient path is:

```text
Battery DC -> inverter AC -> miniPC power brick DC
```

A better field path is:

```text
Battery DC -> regulated DC converter -> miniPC DC input
```

## Runtime Budget

Estimate runtime using watt-hours:

```text
runtime_hours = usable_battery_wh / average_load_watts
```

Example:

```text
300Wh usable battery / 50W average load = 6 hours
```

Use conservative numbers. Cooled cameras, dew heaters, and winter temperatures can change the real draw significantly.

## Measure Real Load

Before trusting a runtime estimate, measure:

- MiniPC idle draw.
- MiniPC draw while NINA/PHD2/ASTAP are active.
- Camera cooling draw at expected setpoint.
- Mount tracking draw.
- Mount slewing draw.
- Dew heater draw at typical output.
- Travel router draw if used.

The average overnight load matters more than peak load, but converters and batteries must tolerate peak draw.

## Design Preferences

- Prefer DC-to-DC conversion over inverter use.
- Keep the miniPC on its own regulated converter if practical.
- Fuse outputs appropriately.
- Label voltage outputs so 19V and 12V connectors cannot be confused.
- Test the full rig for several hours before trusting unattended operation.
- Keep enough local miniPC battery margin to park the mount and warm the camera.

## Open Questions

- Actual miniPC voltage and current rating from its power brick label.
- Actual camera cooler power draw at target temperature.
- Whether dew heaters are part of the field setup.
- Desired unattended runtime.
- Battery chemistry and usable watt-hours.
