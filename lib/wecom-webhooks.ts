/**
 * The group robots — the WeCom groups that receive forwarded notifications.
 *
 * The category set lives in a JSON column because it always travels with
 * the group: it is read, written and matched as one unit, and nothing ever
 * needs to ask "which groups want the `campaign` category?" — that question
 * is answered by the SQL filter in `webhooksForCategory`.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from './db';
import {
  isValidWebhookUrl,
  isWecomCategory,
  type WecomCategory,
  type WecomWebhook,
} from './wecom-types';

/** A `wecom_webhooks` row as the driver hands it back. */
interface WebhookRow extends RowDataPacket {
  id: number;
  name: string;
  webhook_url: string;
  enabled: number;
  categories: string | string[];
}

/** The categories column, which mysql2 may hand back as a string or parsed. */
function parseCategories(raw: string | string[]): WecomCategory[] {
  const list = Array.isArray(raw) ? raw : safeParse(raw);
  return list.filter((c): c is WecomCategory => typeof c === 'string' && isWecomCategory(c));
}

/** JSON.parse that never throws — a corrupt column yields no categories. */
function safeParse(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** One row → the shape the rest of the code uses. */
function toWebhook(row: WebhookRow): WecomWebhook {
  return {
    id: row.id,
    name: row.name,
    webhookUrl: row.webhook_url,
    enabled: row.enabled === 1,
    categories: parseCategories(row.categories),
  };
}

/** Every configured group, oldest first. */
export async function listWebhooks(): Promise<WecomWebhook[]> {
  const [rows] = await getPool().query<WebhookRow[]>(
    `SELECT id, name, webhook_url, enabled, categories
     FROM wecom_webhooks ORDER BY id ASC`,
  );
  return rows.map(toWebhook);
}

/**
 * The enabled groups that want this category.
 *
 * The category filter happens in SQL with `JSON_CONTAINS` — the JSON column
 * is indexed by nothing, but the table holds a handful of groups, and the
 * alternative (loading every group on every notification) would run on the
 * request path of every registered user.
 */
export async function webhooksForCategory(category: WecomCategory): Promise<WecomWebhook[]> {
  const [rows] = await getPool().query<WebhookRow[]>(
    `SELECT id, name, webhook_url, enabled, categories
     FROM wecom_webhooks
     WHERE enabled = 1 AND JSON_CONTAINS(categories, ?)
     ORDER BY id ASC`,
    [JSON.stringify([category])],
  );
  return rows.map(toWebhook);
}

/** The fields a create or an update writes. */
export interface WebhookInput {
  name: string;
  webhookUrl: string;
  enabled: boolean;
  categories: WecomCategory[];
}

/** Rejects an input the storage cannot hold. */
function assertValid(input: WebhookInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error('The group needs a name');
  }
  if (input.name.length > 64) {
    throw new Error('The group name is longer than 64 characters');
  }
  if (!isValidWebhookUrl(input.webhookUrl)) {
    throw new Error(
      'The webhook URL must be a WeCom group robot URL (https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...)',
    );
  }
}

/**
 * Creates a group and returns its id.
 *
 * @throws when the name is taken or the URL is not a WeCom webhook.
 */
export async function createWebhook(input: WebhookInput): Promise<number> {
  assertValid(input);
  const [result] = await getPool().query<ResultSetHeader>(
    `INSERT INTO wecom_webhooks (name, webhook_url, enabled, categories)
     VALUES (?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.webhookUrl,
      input.enabled ? 1 : 0,
      JSON.stringify(input.categories),
    ],
  );
  return Number(result.insertId);
}

/** Updates a group. Throws when the URL is not a WeCom webhook. */
export async function updateWebhook(id: number, input: WebhookInput): Promise<void> {
  assertValid(input);
  await getPool().query(
    `UPDATE wecom_webhooks
     SET name = ?, webhook_url = ?, enabled = ?, categories = ?
     WHERE id = ?`,
    [
      input.name.trim(),
      input.webhookUrl,
      input.enabled ? 1 : 0,
      JSON.stringify(input.categories),
      id,
    ],
  );
}

/** Deletes a group. Its deliveries go with it (the FK cascades). */
export async function deleteWebhook(id: number): Promise<void> {
  await getPool().query(`DELETE FROM wecom_webhooks WHERE id = ?`, [id]);
}
