/** Planfix TimePoint: date as dd-MM-yyyy, optional time as HH:mm. */
export interface TimePoint {
  date: string;
  time?: string;
}

const DMY = /^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?$/;

/**
 * Accepts "dd-MM-yyyy", "dd-MM-yyyy HH:mm[:ss]", "yyyy-MM-dd" and "yyyy-MM-dd HH:mm[:ss]"
 * (a "T" instead of the space also works) and returns a Planfix TimePoint.
 * Throws on anything else, including impossible calendar dates such as 31-02-2026.
 */
export function toTimePoint(input: string): TimePoint {
  const text = input.trim();
  const dmy = DMY.exec(text);
  const match = dmy ?? YMD.exec(text);
  if (!match) {
    throw new Error(
      `Unrecognized date "${input}". Use dd-MM-yyyy, dd-MM-yyyy HH:mm, yyyy-MM-dd or yyyy-MM-dd HH:mm`,
    );
  }
  const [day, month, year] = dmy
    ? [match[1], match[2], match[3]]
    : [match[3], match[2], match[1]];
  const hour = match[4];
  const minute = match[5];

  const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() !== Number(month) - 1 ||
    check.getUTCDate() !== Number(day)
  ) {
    throw new Error(`Invalid calendar date "${input}"`);
  }
  const date = `${day}-${month}-${year}`;
  if (hour === undefined) {
    return { date };
  }
  if (Number(hour) > 23 || Number(minute) > 59) {
    throw new Error(`Invalid time in "${input}"`);
  }
  return { date, time: `${hour}:${minute}` };
}

export interface PeopleRequest {
  users?: { id: string }[];
  groups?: { id: number }[];
}

/** Planfix people/groups collection: users must be prefixed ("user:5"), groups are plain ids. */
export function toPeopleRequest(
  userIds?: number[],
  groupIds?: number[],
): PeopleRequest {
  const people: PeopleRequest = {};
  if (userIds) people.users = userIds.map((id) => ({ id: `user:${id}` }));
  if (groupIds) people.groups = groupIds.map((id) => ({ id }));
  return people;
}

/** Planfix stores rich text as HTML: keep line breaks. */
export function textToHtml(text: string): string {
  return text.replace(/\n/g, "<br>");
}
