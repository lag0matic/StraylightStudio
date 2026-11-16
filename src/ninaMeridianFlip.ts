export type MeridianFlipProfile = {
  id: string; name: string; minutesAfter: number; maximumMinutesAfter: number; pauseBefore: number;
  settleSeconds: number; useSideOfPier: boolean; recenter: boolean; autofocus: boolean; rotatePreview: boolean;
};
export type NativeFlipState = { status: string; hoursToFlip: number | null };

export function readMeridianFlipProfile(value: unknown): MeridianFlipProfile {
  const profile = value as { Id?: unknown; Name?: unknown; MeridianFlipSettings?: Record<string, unknown> } | null;
  const settings = profile?.MeridianFlipSettings;
  if (!settings || typeof profile?.Id !== 'string' || !profile.Id || typeof profile.Name !== 'string') throw new Error('NINA did not return a meridian-flip profile.');
  for (const key of ['MinutesAfterMeridian', 'MaxMinutesAfterMeridian', 'PauseTimeBeforeMeridian', 'SettleTime']) {
    if (typeof settings[key] !== 'number' || !Number.isFinite(settings[key]) || settings[key] < 0) throw new Error(`Invalid NINA flip setting: ${key}.`);
  }
  for (const key of ['UseSideOfPier', 'Recenter', 'AutoFocusAfterFlip', 'RotateImageAfterFlip']) {
    if (typeof settings[key] !== 'boolean') throw new Error(`Missing NINA flip setting: ${key}.`);
  }
  if ((settings.MaxMinutesAfterMeridian as number) < (settings.MinutesAfterMeridian as number)) throw new Error('NINA flip window is reversed.');
  return { id: profile.Id, name: profile.Name, minutesAfter: settings.MinutesAfterMeridian as number,
    maximumMinutesAfter: settings.MaxMinutesAfterMeridian as number, pauseBefore: settings.PauseTimeBeforeMeridian as number,
    settleSeconds: settings.SettleTime as number, useSideOfPier: settings.UseSideOfPier as boolean,
    recenter: settings.Recenter as boolean, autofocus: settings.AutoFocusAfterFlip as boolean, rotatePreview: settings.RotateImageAfterFlip as boolean };
}

export function validateMeridianFlipProfile(profile: MeridianFlipProfile) {
  const parsed = readMeridianFlipProfile({ Id: profile.id, Name: profile.name, MeridianFlipSettings: {
    MinutesAfterMeridian: profile.minutesAfter, MaxMinutesAfterMeridian: profile.maximumMinutesAfter, PauseTimeBeforeMeridian: profile.pauseBefore,
    SettleTime: profile.settleSeconds, UseSideOfPier: profile.useSideOfPier, Recenter: profile.recenter,
    AutoFocusAfterFlip: profile.autofocus, RotateImageAfterFlip: profile.rotatePreview
  } });
  if (!parsed.recenter) throw new Error('Enable re-centering in the NINA meridian-flip profile before using automatic flips.');
  return parsed;
}

export function sameMeridianFlipProfile(a: MeridianFlipProfile, b: MeridianFlipProfile) {
  return (Object.keys(a) as Array<keyof MeridianFlipProfile>).every((key) => a[key] === b[key]);
}

export type FlipEquipment = {
  Mount?: { Connected?: boolean; AlignmentMode?: string; CanSlew?: boolean; TimeToMeridianFlip?: number | string; SideOfPier?: string };
  Camera?: { Connected?: boolean }; Guider?: { Connected?: boolean }; Focuser?: { Connected?: boolean };
};
export function validateFlipEquipment(profile: MeridianFlipProfile, info: FlipEquipment) {
  if (info.Mount?.Connected !== true || info.Mount.AlignmentMode !== 'GermanPolar' || info.Mount.CanSlew !== true) throw new Error('Meridian flips require a connected German equatorial mount with slew support.');
  if (typeof info.Mount.TimeToMeridianFlip !== 'number' || !Number.isFinite(info.Mount.TimeToMeridianFlip)) throw new Error('NINA mount flip timing is unavailable.');
  if (profile.useSideOfPier && !['pierEast', 'pierWest'].includes(info.Mount.SideOfPier ?? '')) throw new Error('The NINA flip profile requires a known pier side.');
  if (info.Camera?.Connected !== true || info.Guider?.Connected !== true) throw new Error('Flip recovery requires connected camera and guider.');
  if (profile.autofocus && info.Focuser?.Connected !== true) throw new Error('NINA has refocus-after-flip enabled, but the focuser is disconnected.');
}

export function flipTriggerState(triggers?: Array<Record<string, unknown>>): NativeFlipState | null {
  const flips = triggers?.filter((trigger) => Object.hasOwn(trigger, 'TimeToFlip')) ?? [];
  if (flips.length !== 1) return null;
  const trigger = flips[0];
  return { status: String(trigger.Status), hoursToFlip: typeof trigger.TimeToFlip === 'number' && Number.isFinite(trigger.TimeToFlip) ? trigger.TimeToFlip : null };
}

export function flipStatusText(state: NativeFlipState | null): string {
  if (!state) return 'Flip status unavailable';
  if (state.status === 'RUNNING') return 'NINA flip in progress';
  if (state.status === 'FINISHED') return 'Flip workflow ended (result not exposed)';
  if (state.status === 'FAILED') return 'NINA flip trigger failed';
  if (state.status !== 'CREATED') return 'Flip trigger unavailable';
  if (state.hoursToFlip === null) return 'Flip armed; timing unavailable';
  const minutes = Math.round(state.hoursToFlip * 60);
  return minutes < 0 ? 'Flip armed; window reached' : `Flip armed: ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
