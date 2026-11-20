/**
 * Turning the composer's rows into template data.
 *
 * ⚠️ A row whose KEY is filled but whose VALUE is empty must not be
 * sent: WeChat refuses an empty field value, and that refusal is a
 * PARAMETER error — which stops the whole broadcast. So one empty row
 * left over from the pre-filled template would deny the announcement to
 * every follower.
 */

/** One row of the composer. */
export interface TemplateField {
  key: string;
  value: string;
}

/**
 * The rows that are actually filled in.
 *
 * @returns the fields to send, and the keys that were skipped.
 */
export function collectTemplateFields(fields: TemplateField[]): {
  data: Record<string, { value: string }>;
  skipped: string[];
} {
  const data: Record<string, { value: string }> = {};
  const skipped: string[] = [];
  for (const field of fields) {
    const key = field.key.trim();
    if (key === '') continue;
    if (field.value.trim() === '') {
      // The row has a name but nothing to put in it. Sending it would
      // make WeChat reject the whole announcement.
      skipped.push(key);
      continue;
    }
    data[key] = { value: field.value };
  }
  return { data, skipped };
}
