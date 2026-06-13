// Pure comparators that reproduce the Prisma `orderBy` semantics used by the review
// selection logic, so the in-memory client store and the Prisma server store sort identically.
//
// cuid ids are ASCII ([0-9a-z]), so JS string comparison matches SQLite's default BINARY
// collation — we only ever sort ids/order/createdAt/dates/randomKey here, never collated text.

export type Comparator<T> = (a: T, b: T) => number

export function chain<T>(...comparators: Comparator<T>[]): Comparator<T> {
  return (a, b) => {
    for (const cmp of comparators) {
      const result = cmp(a, b)
      if (result !== 0) return result
    }
    return 0
  }
}

function cmpNumber(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function timeOf(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null
}

type Nulls = "first" | "last"

function ascNullable(a: number | null, b: number | null, nulls: Nulls): number {
  if (a === null && b === null) return 0
  if (a === null) return nulls === "first" ? -1 : 1
  if (b === null) return nulls === "first" ? 1 : -1
  return cmpNumber(a, b)
}

function descNullable(a: number | null, b: number | null, nulls: Nulls): number {
  if (a === null && b === null) return 0
  if (a === null) return nulls === "first" ? -1 : 1
  if (b === null) return nulls === "first" ? 1 : -1
  return cmpNumber(b, a)
}

export function byDateAsc<T>(get: (x: T) => Date | null, nulls: Nulls): Comparator<T> {
  return (a, b) => ascNullable(timeOf(get(a)), timeOf(get(b)), nulls)
}

export function byDateDesc<T>(get: (x: T) => Date | null, nulls: Nulls): Comparator<T> {
  return (a, b) => descNullable(timeOf(get(a)), timeOf(get(b)), nulls)
}

export function byNumberAsc<T>(get: (x: T) => number | null, nulls: Nulls): Comparator<T> {
  return (a, b) => ascNullable(get(a), get(b), nulls)
}

export function byNumberDesc<T>(get: (x: T) => number | null, nulls: Nulls): Comparator<T> {
  return (a, b) => descNullable(get(a), get(b), nulls)
}

export function byStringAsc<T>(get: (x: T) => string): Comparator<T> {
  return (a, b) => {
    const av = get(a)
    const bv = get(b)
    return av < bv ? -1 : av > bv ? 1 : 0
  }
}

export function byStringDesc<T>(get: (x: T) => string): Comparator<T> {
  return (a, b) => {
    const av = get(a)
    const bv = get(b)
    return av < bv ? 1 : av > bv ? -1 : 0
  }
}
