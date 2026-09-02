/**
 * Officeverse — client-callable client-directory functions.
 *
 * Replaces the old localStorage `officeverse.clients` store. Every handler
 * authenticates (`requireUser`) and the service enforces Admin / HR for every
 * read and write. The server generates the CLT-##### code; the client never
 * chooses the id or the status enum outside the allowed set.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/clients/service";

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const statusEnum = z.enum(["active", "prospect", "inactive", "closed"]);
const clientCode = z
  .string()
  .trim()
  .regex(/^CLT-\d{5}$/, "Expected CLT-#####");

const emailOpt = z
  .string()
  .trim()
  .max(191)
  .email()
  .optional()
  .or(z.literal("").transform(() => undefined));

const createInput = z.object({
  name: z.string().trim().min(2).max(200),
  contact_name: z.string().trim().max(200).optional(),
  email: emailOpt,
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  status: statusEnum.optional(),
  registered_on: ymd.optional(),
});

const listInput = z.object({
  q: z.string().trim().max(120).optional(),
  status: statusEnum.optional(),
});

const updateInput = z.object({
  code: clientCode,
  contact_name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  status: statusEnum.optional(),
});

export const createClientFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data }): Promise<{ client: svc.ClientDTO }> => {
    const user = await requireUser();
    return { client: await svc.createClient(user, data, requestInfo()) };
  });

export const listClientsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data }): Promise<svc.ListClientsResult> => {
    const user = await requireUser();
    return svc.listClients(user, data);
  });

export const updateClientFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data }): Promise<{ client: svc.ClientDTO }> => {
    const user = await requireUser();
    return { client: await svc.updateClient(user, data, requestInfo()) };
  });
