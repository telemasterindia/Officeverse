import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRightLeft,
  Download,
  FileText,
  Trash2,
  Upload,
  UserCheck,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  LeadIdChip,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/officeverse/primitives";
import { FollowUpStatusBadge } from "@/components/officeverse/follow-up-detail";
import { displayDateTime } from "@/lib/officeverse/followups";
import { useSession } from "@/lib/officeverse/session";
import {
  useAssignableClosers,
  useDeleteLeadDocument,
  useDeleteServerLead,
  useDownloadLeadDocument,
  useLeadDocuments,
  useServerFollowUps,
  useServerLead,
  useTransferServerLead,
  useUploadLeadDocument,
  LEAD_DOC_ACCEPT,
  LEAD_DOC_MAX_BYTES,
  type UiFollowUp,
  type UiLead,
} from "@/lib/officeverse/use-lead-lifecycle";

export const Route = createFileRoute("/_shell/leads/$leadId")({
  head: ({ params }) => ({
    meta: [{ title: `Lead ${params.leadId} — TeleMaster India` }],
  }),
  component: LeadDetailPage,
});

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 font-medium">{value}</span>
    </div>
  );
}

function FuRow({ f }: { f: UiFollowUp }) {
  return (
    <Link
      to="/followups/$followUpId"
      params={{ followUpId: f.follow_up_id }}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-left transition-colors hover:border-primary/40"
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{f.follow_up_id}</span>
          <FollowUpStatusBadge fu={f} />
        </span>
        <span className="mt-1 block text-sm font-semibold">{displayDateTime(f.scheduled_at)}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {f.owner_name} · {f.owner_role === "closer" ? "Closer" : "Agent"} follow-up · “
          {f.comment || "—"}”
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-accent">Open</span>
    </Link>
  );
}

/**
 * Admin UAT §2 — Lead → Closer assignment. Admin-only control that assigns (or
 * reassigns) an existing lead's closer. Uses the server `transferLead`, which
 * enforces same-process routing, ownership history + audit; ownership then
 * reflects immediately for the new closer everywhere (cache invalidation).
 */
function ReassignCloserCard({ lead }: { lead: UiLead }) {
  // Server-authoritative: the list is already active + same-process + minus the
  // current closer. The client filter below is defence-in-depth only.
  const { closers } = useAssignableClosers({ leadCode: lead.lead_id });
  const transfer = useTransferServerLead();
  const [toCode, setToCode] = useState("");
  const [note, setNote] = useState("");

  const current = lead.assigned_closer_code;
  const options = closers.filter(
    (c) => c.code !== current && (!lead.process || c.process === lead.process),
  );
  const disabled = !toCode || transfer.isPending;

  function submit() {
    if (!toCode) return;
    transfer.mutate(
      { code: lead.lead_id, to_closer_code: toCode, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: (r) => {
          setToCode("");
          setNote("");
          toast.success(`Lead assigned to ${r.lead.assigned_closer_name ?? toCode}`);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not assign closer"),
      },
    );
  }

  return (
    <SectionCard
      title="Assign / reassign closer"
      description={
        (current
          ? `Currently with ${lead.assigned_closer}. Ownership moves immediately.`
          : "This lead has no closer yet.") +
        (lead.process ? ` Only ${lead.process}-process closers are eligible.` : "")
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Destination closer</Label>
          <Select value={toCode} onValueChange={setToCode} disabled={options.length === 0}>
            <SelectTrigger>
              <SelectValue
                placeholder={
                  options.length === 0
                    ? `No eligible ${lead.process ?? ""} closer available`
                    : "Select a closer"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name} — {c.process}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Reason (optional, audited)</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Workload rebalancing"
          />
        </div>
        <Button onClick={submit} disabled={disabled}>
          <UserCheck className="mr-1.5 h-4 w-4" />
          {transfer.isPending ? "Assigning…" : current ? "Reassign closer" : "Assign closer"}
        </Button>
      </div>
    </SectionCard>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * §3–§6 — Supporting documents. Anyone who can open this lead detail already
 * passed `canReadLead`, and document access is the SAME surface
 * (`canAccessLeadDocuments === canReadLead`), so the card renders for every
 * viewer here; the server re-checks every upload / download / delete. No public
 * URLs — downloads stream base64 through an authenticated server fn.
 */
function LeadDocumentsCard({ leadCode }: { leadCode: string }) {
  const { documents, isLoading } = useLeadDocuments(leadCode);
  const upload = useUploadLeadDocument();
  const download = useDownloadLeadDocument();
  const del = useDeleteLeadDocument(leadCode);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);

  function choose(file: File | null) {
    if (!file) return;
    if (file.size > LEAD_DOC_MAX_BYTES) {
      toast.error("That file is larger than the 10 MB limit.");
      return;
    }
    setPendingName(file.name);
    upload.mutate(
      { lead_code: leadCode, file },
      {
        onSuccess: (r) => {
          setPendingName(null);
          toast.success(`Uploaded ${r.document.file_name}`);
        },
        onError: (e) => {
          setPendingName(null);
          toast.error(e instanceof Error ? e.message : "Upload failed");
        },
      },
    );
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <SectionCard
      title="Supporting documents"
      description="Optional files attached to this lead. Visible only to people authorised for this lead."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {upload.isPending ? "Uploading…" : "Upload document"}
          </Button>
          {pendingName ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{pendingName}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              PDF or image (PNG/JPEG/WebP), up to 10 MB
            </span>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={LEAD_DOC_ACCEPT}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading documents…</p>
        ) : documents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
            No documents attached.
          </p>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-sm"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.file_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {fmtBytes(d.size_bytes)}
                    {d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ""}
                    {d.uploaded_by_role ? ` (${d.uploaded_by_role})` : ""}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-lg"
                  disabled={download.isPending}
                  onClick={() =>
                    download.mutate(
                      { document_id: d.id },
                      {
                        onError: (e) =>
                          toast.error(e instanceof Error ? e.message : "Download failed"),
                      },
                    )
                  }
                >
                  <Download className="h-4 w-4" />
                </Button>
                {d.can_delete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-lg text-destructive hover:text-destructive"
                    disabled={del.isPending}
                    onClick={() => {
                      if (!window.confirm(`Delete “${d.file_name}”? This cannot be undone.`))
                        return;
                      del.mutate(
                        { document_id: d.id },
                        {
                          onSuccess: () => toast.success("Document deleted"),
                          onError: (e) =>
                            toast.error(e instanceof Error ? e.message : "Delete failed"),
                        },
                      );
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

/**
 * §2 — Admin-only TRUE hard delete. Requires typing the exact lead code to
 * confirm. The server re-authorises (admin only) and permanently removes the
 * lead row + its duplicate-detection identity; this is not a soft delete.
 */
function DeleteLeadCard({ lead }: { lead: UiLead }) {
  const navigate = useNavigate();
  const del = useDeleteServerLead();
  const [confirmText, setConfirmText] = useState("");
  const armed = confirmText.trim() === lead.lead_id;

  function submit() {
    if (!armed || del.isPending) return;
    del.mutate(
      { code: lead.lead_id },
      {
        onSuccess: (r) => {
          toast.success(`Lead ${r.lead_code} permanently deleted`);
          void navigate({ to: "/leads" });
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete the lead"),
      },
    );
  }

  return (
    <SectionCard
      title="Delete lead"
      description="Permanently removes this lead and its records from the database. It cannot be recovered, and its phone number becomes free for a new lead. This is not an archive."
    >
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Type <span className="font-mono font-semibold">{lead.lead_id}</span> to confirm
          </Label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={lead.lead_id}
            autoComplete="off"
          />
        </div>
        <Button variant="destructive" disabled={!armed || del.isPending} onClick={submit}>
          <Trash2 className="mr-1.5 h-4 w-4" />
          {del.isPending ? "Deleting…" : "Permanently delete this lead"}
        </Button>
      </div>
    </SectionCard>
  );
}

function LeadDetailPage() {
  const { leadId } = Route.useParams();
  const { user } = useSession();
  const { lead, isLoading } = useServerLead(leadId);
  const { followUps: all } = useServerFollowUps();

  const convertedFrom = useMemo(
    () => all.find((f) => f.converted_lead_id === leadId) ?? null,
    [all, leadId],
  );

  const groups = useMemo(() => {
    const mine = all.filter((f) => f.lead_id === leadId || f.converted_lead_id === leadId);
    return {
      upcoming: mine
        .filter((f) => f.status === "SCHEDULED")
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
      completed: mine
        .filter((f) => f.status === "COMPLETED" || f.status === "CONVERTED")
        .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)),
      cancelled: mine
        .filter((f) => f.status === "CANCELLED")
        .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)),
      total: mine.length,
    };
  }, [all, leadId]);

  if (!lead) {
    if (isLoading) {
      return <p className="py-16 text-center text-sm text-muted-foreground">Loading lead…</p>;
    }
    return (
      <div className="space-y-6">
        <PageHeader title="Lead not found" description={`No lead matches ${leadId}.`} />
        <Button asChild variant="outline" className="rounded-lg">
          <Link to="/leads">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to My Leads
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/leads"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> My Leads
        </Link>
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              <LeadIdChip id={lead.lead_id} />
              <StatusBadge status={lead.status} />
            </span>
          }
          title={lead.customer_name}
          description={
            [[lead.city, lead.state].filter(Boolean).join(", "), lead.file_name]
              .filter(Boolean)
              .join(" · ") || "New customer Lead"
          }
        />
      </div>

      {convertedFrom ? (
        <Card className="flex flex-wrap items-center gap-2 rounded-xl border-accent/30 bg-accent/8 p-4 text-sm shadow-sm">
          <ArrowRightLeft className="h-4 w-4 text-accent" />
          <span>
            This Lead was <strong>converted from follow-up</strong>{" "}
            <Link
              to="/followups/$followUpId"
              params={{ followUpId: convertedFrom.follow_up_id }}
              className="font-mono text-accent hover:underline"
            >
              {convertedFrom.follow_up_id}
            </Link>{" "}
            by {convertedFrom.created_by}
            {convertedFrom.converted_at
              ? ` · ${new Date(convertedFrom.converted_at).toLocaleDateString()}`
              : ""}
            .
          </span>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Customer" description="The master record — follow-ups attach here">
          <div className="divide-y divide-border/70">
            <Field label="Customer name" value={lead.customer_name} />
            <Field label="Phone" value={lead.phone} />
            <Field label="Email" value={lead.email} />
            <Field label="Address" value={lead.address} />
            <Field label="City" value={lead.city} />
            <Field label="State" value={lead.state} />
            <Field label="ZIP" value={lead.zip} />
          </div>
        </SectionCard>

        <SectionCard title="Routing & status" description="Ownership and pipeline state">
          <div className="divide-y divide-border/70">
            <Field label="Date" value={lead.created_at} />
            <Field label="Lead file" value={lead.file_name} />
            <Field label="Assigned agent" value={lead.submitted_by} />
            <Field label="Assigned closer" value={lead.assigned_closer} />
            <Field label="Status" value={<StatusBadge status={lead.status} />} />
            <Field label="Debt amount" value={`$${lead.debt_amount.toLocaleString()}`} />
            <Field label="Credit status" value={lead.credit} />
            <Field label="Current debts" value={lead.current_late} />
          </div>
        </SectionCard>
      </div>

      {user?.role === "admin" ? <ReassignCloserCard lead={lead} /> : null}

      <LeadDocumentsCard leadCode={lead.lead_id} />

      {lead.comment ? (
        <SectionCard title="Lead notes" description="Captured when the Lead was created">
          <p className="text-sm">{lead.comment}</p>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Follow-ups for this Lead"
        description={`${groups.total} attached · one Lead, many follow-ups`}
      >
        {groups.total === 0 ? (
          <EmptyState
            emoji="🗓️"
            title="No follow-ups yet"
            message="Schedule the next conversation — the customer details are already here."
          />
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Upcoming ({groups.upcoming.length})
              </p>
              {groups.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="space-y-2.5">
                  {groups.upcoming.map((f) => (
                    <li key={f.follow_up_id}>
                      <FuRow f={f} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {groups.completed.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Completed ({groups.completed.length})
                </p>
                <ul className="space-y-2.5">
                  {groups.completed.map((f) => (
                    <li key={f.follow_up_id}>
                      <FuRow f={f} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {groups.cancelled.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Cancelled ({groups.cancelled.length})
                </p>
                <ul className="space-y-2.5">
                  {groups.cancelled.map((f) => (
                    <li key={f.follow_up_id}>
                      <FuRow f={f} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      <Card className="rounded-xl border-border bg-secondary/30 p-4 text-xs text-muted-foreground shadow-sm">
        Follow-ups always reference this Lead by ID (
        <span className="font-mono">{lead.lead_id}</span>
        ). Customer details, email and the Lead file come from here — they are never re-entered on a
        follow-up.
      </Card>

      {user?.role === "admin" ? <DeleteLeadCard lead={lead} /> : null}
    </div>
  );
}
