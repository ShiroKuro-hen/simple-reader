import { describe, expect, it } from 'vitest';
import { bookLabel, fractionFromSlider, keyAction, progressLabel, resolveTheme, sliderPosition, stepFontSize } from './reading';

describe('progressLabel', () => {
  it('rounds to a percentage', () => {
    expect(progressLabel(0)).toBe('0%');
    expect(progressLabel(0.426)).toBe('43%');
  });
  it('never claims 100% before the very end', () => {
    expect(progressLabel(0.996)).toBe('99%');
    expect(progressLabel(1)).toBe('100%');
  });
  it('survives garbage from a reader', () => {
    expect(progressLabel(NaN)).toBe('0%');
    expect(progressLabel(-1)).toBe('0%');
    expect(progressLabel(7)).toBe('100%');
  });
});

describe('slider mapping', () => {
  it('maps fractions to the 0..1000 range and back', () => {
    expect(sliderPosition(0.5)).toBe(500);
    expect(fractionFromSlider(250)).toBe(0.25);
    expect(sliderPosition(2)).toBe(1000);
    expect(sliderPosition(NaN)).toBe(0);
  });
});

describe('bookLabel', () => {
  it('mentions progress only once the book was started', () => {
    expect(bookLabel('Kokoro', null)).toBe('Open Kokoro');
    expect(bookLabel('Kokoro', 0)).toBe('Open Kokoro');
    expect(bookLabel('Kokoro', 0.42)).toBe('Open Kokoro, 42% read');
  });
});

describe('resolveTheme', () => {
  it('follows the system until the user picks', () => {
    expect(resolveTheme(null, false)).toBe('light');
    expect(resolveTheme(null, true)).toBe('dark');
  });
  it('a stored pick wins over the system, including sepia', () => {
    expect(resolveTheme('sepia', true)).toBe('sepia');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('ignores a corrupt stored value', () => {
    expect(resolveTheme('neon', true)).toBe('dark');
    expect(resolveTheme(42, false)).toBe('light');
  });
});

describe('stepFontSize', () => {
  it('moves in 10% steps within 60..220', () => {
    expect(stepFontSize(100, 1)).toBe(110);
    expect(stepFontSize(100, -1)).toBe(90);
    expect(stepFontSize(60, -1)).toBe(60);
    expect(stepFontSize(220, 1)).toBe(220);
    expect(stepFontSize(215, 1)).toBe(220);
  });
});

const key = (k: string, extra: Omit<Parameters<typeof keyAction>[0], 'key'> = {}) => keyAction({ key: k, ...extra });

describe('keyAction', () => {
  it('turns pages with arrows, PageUp/PageDown and Space', () => {
    expect(key('ArrowRight')).toBe('next');
    expect(key('PageDown')).toBe('next');
    expect(key(' ')).toBe('next');
    expect(key('ArrowLeft')).toBe('prev');
    expect(key('PageUp')).toBe('prev');
    expect(key(' ', { shiftKey: true })).toBe('prev');
  });
  it('Escape closes the popup first, then toggles the chrome', () => {
    expect(key('Escape', { popupOpen: true })).toBe('close-popup');
    expect(key('Escape')).toBe('toggle-chrome');
  });
  it('Tab reveals the chrome', () => {
    expect(key('Tab')).toBe('show-chrome');
  });
  it('stays out of the way of text fields, sliders, dialogs and shortcuts', () => {
    expect(key('ArrowRight', { targetTag: 'INPUT' })).toBeNull();
    expect(key('ArrowLeft', { targetTag: 'SELECT' })).toBeNull();
    expect(key('ArrowRight', { dialogOpen: true })).toBeNull();
    expect(key('ArrowRight', { ctrlKey: true })).toBeNull();
    expect(key('ArrowRight', { metaKey: true })).toBeNull();
    expect(key('ArrowRight', { altKey: true })).toBeNull();
  });
  it('lets Space activate a focused button or link instead of turning the page', () => {
    expect(key(' ', { targetTag: 'BUTTON' })).toBeNull();
    expect(key(' ', { targetTag: 'A' })).toBeNull();
    expect(key('ArrowRight', { targetTag: 'BUTTON' })).toBe('next');
  });
  it('ignores other keys', () => {
    expect(key('a')).toBeNull();
    expect(key('Enter')).toBeNull();
  });
});
