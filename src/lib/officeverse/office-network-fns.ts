/**
 * Officeverse — authorized office-network management server functions
 * (Phase 23). HR / Admin only — the service enforces it; Agents / Closers
 * cannot see or change these.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/net/office-networks";

const proc = z.enum(["US", "UK", "IN", "AU"]);
const idInput = z.object({ id: z.coerce.number().int().positive() });

export const officeNetworksFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.listOfficeNetworks(user);
  });

export const addOfficeNetworkFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(2).max(80),
        cidr: z.string().trim().min(3).max(64),
        process: proc.nullish(),
        note: z.string().trim().max(255).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.addOfficeNetwork(
      user,
      {
        name: data.name,
        cidr: data.cidr,
        ...(data.process != null ? { process: data.process } : {}),
        ...(data.note !== undefined ? { note: data.note } : {}),
      },
      requestInfo(),
    );
  });

export const updateOfficeNetworkFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.coerce.number().int().positive(),
        name: z.string().trim().min(2).max(80).optional(),
        cidr: z.string().trim().min(3).max(64).optional(),
        process: proc.nullish(),
        note: z.string().trim().max(255).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { id, ...patch } = data;
    return svc.updateOfficeNetwork(
      user,
      id,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.cidr !== undefined ? { cidr: patch.cidr } : {}),
        ...(patch.process !== undefined ? { process: patch.process ?? null } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      },
      requestInfo(),
    );
  });

export const setOfficeNetworkEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.coerce.number().int().positive(),
        enabled: z.boolean(),
        confirmLockout: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.setOfficeNetworkEnabled(
      user,
      data.id,
      data.enabled,
      {
        ...(data.confirmLockout !== undefined ? { confirmLockout: data.confirmLockout } : {}),
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
      },
      requestInfo(),
    );
  });

export const removeOfficeNetworkFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    idInput
      .extend({
        confirmLockout: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.removeOfficeNetwork(
      user,
      data.id,
      {
        ...(data.confirmLockout !== undefined ? { confirmLockout: data.confirmLockout } : {}),
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
      },
      requestInfo(),
    );
  });
