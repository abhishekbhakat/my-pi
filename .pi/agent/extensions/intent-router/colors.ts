// Fixed 24-bit ANSI colors, theme-independent.
// Intent-router state colors: switch=green, restore=blue, adv override=orange.

function fg(r: number, g: number, b: number, text: string): string {
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

export const GREEN = (text: string) => fg(80, 220, 120, text);
export const BLUE = (text: string) => fg(90, 160, 255, text);
export const ORANGE = (text: string) => fg(255, 170, 60, text);
export const RED = (text: string) => fg(255, 80, 80, text);
export const DIM = (text: string) => `\x1b[2m${text}\x1b[22m`;
