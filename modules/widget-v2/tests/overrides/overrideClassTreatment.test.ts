import { describe, it, expect } from 'vitest';
import { OVERRIDE_CLASS_TREATMENT } from '../../src/overrides/overrideClassTreatment';
import type { OverrideClass } from '../../src/wire/types';

describe('OVERRIDE_CLASS_TREATMENT', () => {
  it('maps every override_class to a treatment', () => {
    const classes: OverrideClass[] = [
      'emergency_safety',
      'system_maintenance',
      'scoreboard_correction',
      'operator_alert',
    ];
    for (const c of classes) {
      expect(OVERRIDE_CLASS_TREATMENT[c]).toBeDefined();
    }
  });

  it('renders emergency_safety and system_maintenance as fullscreen cards', () => {
    expect(OVERRIDE_CLASS_TREATMENT.emergency_safety.form).toBe('fullscreen');
    expect(OVERRIDE_CLASS_TREATMENT.system_maintenance.form).toBe('fullscreen');
  });

  it('renders scoreboard_correction and operator_alert as top banners', () => {
    expect(OVERRIDE_CLASS_TREATMENT.scoreboard_correction.form).toBe('top-banner');
    expect(OVERRIDE_CLASS_TREATMENT.operator_alert.form).toBe('top-banner');
  });

  it('carries the canned copy from the spec table', () => {
    expect(OVERRIDE_CLASS_TREATMENT.scoreboard_correction.cannedCopy).toBe('Scoreboard under review');
    expect(OVERRIDE_CLASS_TREATMENT.operator_alert.cannedCopy).toBe('Notice');
    expect(OVERRIDE_CLASS_TREATMENT.emergency_safety.cannedCopy.length).toBeGreaterThan(0);
    expect(OVERRIDE_CLASS_TREATMENT.system_maintenance.cannedCopy.length).toBeGreaterThan(0);
  });

  it('ranks emergency_safety highest by visualPriority', () => {
    const t = OVERRIDE_CLASS_TREATMENT;
    expect(t.emergency_safety.visualPriority).toBeGreaterThan(t.system_maintenance.visualPriority);
    expect(t.system_maintenance.visualPriority).toBeGreaterThan(t.scoreboard_correction.visualPriority);
    expect(t.scoreboard_correction.visualPriority).toBeGreaterThan(t.operator_alert.visualPriority);
  });
});
