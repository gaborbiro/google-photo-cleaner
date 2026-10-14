// Numbers in words, the same way on every screen.

/** "19,021". */
export const n = (value: number) => value.toLocaleString('en-GB');

/** "1 page", "43 pages". */
export const count = (value: number, one: string, many: string) => `${n(value)} ${value === 1 ? one : many}`;
