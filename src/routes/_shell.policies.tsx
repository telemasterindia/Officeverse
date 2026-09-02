import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import {
  useDeletePolicy,
  usePolicies,
  useSavePolicy,
  useSetPolicyStatus,
  type PolicyDTO,
} from "@/lib/officeverse/use-hr-policy";

export const Route = createFileRoute("/_shell/policies")({
  head: () => ({ meta: [{ title: "HR Policy — TeleMaster India" }] }),
  component: PoliciesPage,
});

/** "2026-09-01 15:45:00" → "2026-09-01 15:45"; blank stays blank. */
function fmtWhen(v: string | null | undefined): string {
  return v ? v.slice(0, 16) : "—";
}

function StatusBadge({ status }: { status: PolicyDTO["status"] }) {
  return (
    <Badge
      variant={status === "PUBLISHED" ? "default" : "secondary"}
      className="rounded-full text-[11px]"
    >
      {status === "PUBLISHED" ? "Published" : "Draft"}
    </Badge>
  );
}

function PoliciesPage() {
  const q = usePolicies();
  const canManage = q.data?.canManage ?? false;
  const rows = q.data?.rows ?? [];
  const [viewing, setViewing] = useState<PolicyDTO | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR Policy"
        description={
          canManage
            ? "Create, edit and publish company HR policies. Agents and Closers see published policies only."
            : "Company HR policies. Read-only."
        }
      />
      {canManage ? <PolicyEditor /> : null}

      <SectionCard title={canManage ? "All policies" : "Published policies"}>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : q.data?.dbUnavailable ? (
          <EmptyState emoji="🗄️" title="Database not connected" message="Policies need the DB." />
        ) : rows.length === 0 ? (
          <EmptyState
            emoji="📋"
            title="No policies yet"
            message={canManage ? "Create the first one above." : "Nothing published yet."}
          />
        ) : (
          <ul className="space-y-3">
            {rows.map((p) => (
              <PolicyCard key={p.id} p={p} canManage={canManage} onView={() => setViewing(p)} />
            ))}
          </ul>
        )}
      </SectionCard>

      <PolicyViewDialog policy={viewing} onOpenChange={(v) => !v && setViewing(null)} />
    </div>
  );
}

/**
 * The full published/edited policy — title, complete content (no truncation),
 * effective date, published date, last updated, published by. Opened by the
 * `View` action for every role (Agent/Closer included); it never renders an
 * Edit or Delete control.
 */
function PolicyViewDialog({
  policy,
  onOpenChange,
}: {
  policy: PolicyDTO | null;
  onOpenChange: (v: boolean) => void;
}) {
  if (!policy) return null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {policy.title}
            <StatusBadge status={policy.status} />
          </DialogTitle>
          <DialogDescription>Complete policy content</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="font-semibold uppercase text-muted-foreground">Effective date</dt>
            <dd className="mt-0.5">{policy.effective_date ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase text-muted-foreground">Published date</dt>
            <dd className="mt-0.5">{fmtWhen(policy.published_at)}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase text-muted-foreground">Last updated</dt>
            <dd className="mt-0.5">{fmtWhen(policy.updated_at)}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase text-muted-foreground">Published by</dt>
            <dd className="mt-0.5">{policy.published_by_name ?? "—"}</dd>
          </div>
        </dl>

        <div className="whitespace-pre-wrap rounded-lg border border-border bg-secondary/30 p-4 text-sm leading-relaxed">
          {policy.content}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PolicyEditor({ initial, onDone }: { initial?: PolicyDTO; onDone?: () => void }) {
  const save = useSavePolicy();
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    content: initial?.content ?? "",
    effective_date: initial?.effective_date ?? "",
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      toast.error("Title and content are required");
      return;
    }
    save.mutate(
      {
        ...(initial ? { id: initial.id } : {}),
        title: form.title.trim(),
        content: form.content.trim(),
        ...(form.effective_date ? { effective_date: form.effective_date } : {}),
      },
      {
        onSuccess: () => {
          toast.success(initial ? "Policy updated" : "Draft created");
          if (!initial) setForm({ title: "", content: "", effective_date: "" });
          onDone?.();
        },
        onError: (err) => toast.error(err.message || "Could not save"),
      },
    );
  };

  return (
    <SectionCard title={initial ? `Edit — ${initial.title}` : "New policy"}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Policy title</span>
            <input
              className="w-full rounded-lg border border-border bg-card px-3 py-2"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
              required
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Effective date</span>
            <input
              type="date"
              className="w-full rounded-lg border border-border bg-card px-3 py-2"
              value={form.effective_date}
              onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
            />
          </label>
        </div>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Policy content</span>
          <textarea
            className="min-h-[160px] w-full rounded-lg border border-border bg-card px-3 py-2"
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            maxLength={50_000}
            required
          />
        </label>
        <div className="flex gap-2">
          <Button type="submit" className="rounded-lg" disabled={save.isPending}>
            {save.isPending ? "Saving…" : initial ? "Save changes" : "Create draft"}
          </Button>
          {initial && onDone ? (
            <Button type="button" variant="outline" className="rounded-lg" onClick={onDone}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </SectionCard>
  );
}

/**
 * One row: Policy Title | Effective Date | Published | View [| Edit | Delete].
 * `View` is available to every role and only ever opens the read-only detail
 * dialog. Edit / Publish-Unpublish / Delete render ONLY when `canManage` (HR /
 * Admin) — Agents and Closers never see them, and the server independently
 * rejects the corresponding actions for those roles.
 */
function PolicyCard({
  p,
  canManage,
  onView,
}: {
  p: PolicyDTO;
  canManage: boolean;
  onView: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const status = useSetPolicyStatus();
  const remove = useDeletePolicy();

  if (editing) {
    return (
      <li>
        <PolicyEditor initial={p} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const toggle = () =>
    status.mutate(
      { id: p.id, publish: p.status !== "PUBLISHED" },
      {
        onSuccess: () =>
          toast.success(p.status === "PUBLISHED" ? "Policy unpublished" : "Policy published"),
        onError: (err) => toast.error(err.message || "Failed"),
      },
    );

  const remove_ = () => {
    if (!window.confirm(`Delete “${p.title}”? This cannot be undone.`)) return;
    remove.mutate(
      { id: p.id },
      {
        onSuccess: () => toast.success("Policy deleted"),
        onError: (err) => toast.error(err.message || "Could not delete"),
      },
    );
  };

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="grid items-center gap-3 sm:grid-cols-[2fr_auto_auto_auto]">
        <div className="min-w-0">
          <p className="truncate font-semibold">{p.title}</p>
        </div>
        <p className="text-xs text-muted-foreground sm:text-sm">
          <span className="font-semibold uppercase text-[10px] tracking-wide sm:hidden">
            Effective:{" "}
          </span>
          {p.effective_date ?? "—"}
        </p>
        <StatusBadge status={p.status} />
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <Button size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={onView}>
            View
          </Button>
          {canManage ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-full text-xs"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant={p.status === "PUBLISHED" ? "outline" : "default"}
                className="h-8 rounded-full text-xs"
                disabled={status.isPending}
                onClick={toggle}
              >
                {p.status === "PUBLISHED" ? "Unpublish" : "Publish"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-full text-xs text-destructive hover:text-destructive"
                disabled={remove.isPending}
                onClick={remove_}
              >
                Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}
