import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { LeadIdChip, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import {
  displayDateTime,
  shiftDateIST,
  todayIST,
  type FollowUpCustomer,
} from "@/lib/officeverse/followups";
import {
  fuDtoToUi,
  leadDtoToUi,
  useAssignableClosers,
  useCreateServerFollowUp,
  useCreateServerLead,
  useLeadDuplicateCheck,
  useUploadLeadDocument,
  LEAD_DOC_ACCEPT,
  LEAD_DOC_MAX_BYTES,
  type UiFollowUp,
  type UiLead,
} from "@/lib/officeverse/use-lead-lifecycle";
import { isValidEmail, usPhoneDigits } from "@/lib/officeverse/phone";
import { US_STATES, sanitizeZip } from "@/lib/officeverse/us-states";
import { useSession } from "@/lib/officeverse/session";
import type { FieldCheckResult } from "@/server/leads/service";

type Action = "" | "lead" | "followup";

export const Route = createFileRoute("/_shell/leads/new")({
  validateSearch: (s: Record<string, unknown>): { action?: "followup"; date?: string } => {
    const out: { action?: "followup"; date?: string } = {};
    if (s["action"] === "followup") out.action = "followup";
    if (typeof s["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s["date"]))
      out.date = s["date"];
    return out;
  },
  head: () => ({
    meta: [
      { title: "New Customer — TeleMaster India" },
      {
        name: "description",
        content: "Capture the customer once, then create a Lead or schedule a follow-up.",
      },
    ],
  }),
  component: NewLeadPage,
});

/* --------------------------- inline field status ----------------------- */

type FieldStatusKind = "none" | "checking" | "valid" | "invalid" | "duplicate";

/** One-line inline validation / duplicate feedback under a field. `tone` lets
 *  the phone use an ERROR-styled duplicate and the (optional) email a WARNING. */
function FieldStatus({
  kind,
  invalidMsg,
  dup,
  tone = "error",
  label,
}: {
  kind: FieldStatusKind;
  invalidMsg: string;
  dup: FieldCheckResult["duplicate"];
  tone?: "error" | "warning";
  /** "lead" — a phone/email that identifies a lead */
  label: string;
}) {
  if (kind === "none") return null;
  if (kind === "checking")
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
      </p>
    );
  if (kind === "invalid")
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-destructive">
        <XCircle className="h-3.5 w-3.5" /> {invalidMsg}
      </p>
    );
  if (kind === "valid")
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> No duplicate found.
      </p>
    );
  // duplicate
  const isWarn = tone === "warning";
  return (
    <div
      className={
        "mt-1.5 rounded-lg border p-2.5 text-xs " +
        (isWarn
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-destructive/40 bg-destructive/10 text-destructive")
      }
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" />
        {isWarn
          ? `This ${label} is already on another lead`
          : `Duplicate ${label} — a lead already exists`}
      </p>
      {dup?.visible && dup.lead_id ? (
        <p className="mt-1 text-[11px] opacity-90">
          Existing lead <span className="font-mono font-semibold">{dup.lead_id}</span>
          {dup.status ? <> · status {dup.status}</> : null}
        </p>
      ) : (
        <p className="mt-1 text-[11px] opacity-90">
          The existing lead is owned by another team member.
        </p>
      )}
    </div>
  );
}

function NewLeadPage() {
  const { user } = useSession();
  const search = Route.useSearch();
  const formRef = useRef<HTMLFormElement>(null);

  const [action, setAction] = useState<Action>(search.action === "followup" ? "followup" : "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [phoneBlur, setPhoneBlur] = useState(false);
  const [emailBlur, setEmailBlur] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [credit, setCredit] = useState("");
  const [currentLate, setCurrentLate] = useState("");
  const [closer, setCloser] = useState("");
  const [fuDate, setFuDate] = useState(search.date ?? "");
  const [fuTime, setFuTime] = useState("");
  const [fuComment, setFuComment] = useState("");
  const [createdLead, setCreatedLead] = useState<UiLead | null>(null);
  const [createdFu, setCreatedFu] = useState<UiFollowUp | null>(null);
  // §3/§6 — OPTIONAL supporting document for a new Lead. Never required.
  const [docFile, setDocFile] = useState<File | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const createLeadM = useCreateServerLead();
  const createFuM = useCreateServerFollowUp();
  const uploadDocM = useUploadLeadDocument();
  const { closers } = useAssignableClosers();
  const busy = createLeadM.isPending || createFuM.isPending || uploadDocM.isPending;

  const success = createdLead != null || createdFu != null;

  /* ---- inline phone / email validation + authoritative duplicate check ---- *
   * Client validation is UX only; `createLead` re-validates + re-checks the
   * duplicate on submit (an Agent cannot bypass it). No localStorage.         */
  const phoneDigits = usPhoneDigits(phone); // canonical 10, or null
  const phoneRawDigits = phone.replace(/\D/g, "").length;
  const emailTrim = email.trim();
  const emailClientValid = emailTrim === "" || isValidEmail(emailTrim);

  // debounced keys — only a fully-valid value triggers a server check
  const [dupKeys, setDupKeys] = useState<{ phone: string | null; email: string | null }>({
    phone: null,
    email: null,
  });
  useEffect(() => {
    const t = setTimeout(() => {
      setDupKeys({
        phone: phoneDigits,
        email: emailTrim && isValidEmail(emailTrim) ? emailTrim.toLowerCase() : null,
      });
    }, 450);
    return () => clearTimeout(t);
  }, [phoneDigits, emailTrim]);

  const dupQ = useLeadDuplicateCheck(dupKeys);
  const dupSettled = !dupQ.isFetching;

  const phone_ = useMemo<{
    kind: FieldStatusKind;
    blocked: boolean;
    dup: FieldCheckResult["duplicate"];
  }>(() => {
    if (phone.trim() === "") {
      return { kind: submitAttempted ? "invalid" : "none", blocked: true, dup: null };
    }
    if (phoneDigits === null) {
      // show the "invalid" message once the value looks complete, on blur, or on submit
      const show = phoneRawDigits >= 10 || phoneBlur || submitAttempted;
      return { kind: show ? "invalid" : "none", blocked: true, dup: null };
    }
    if (dupKeys.phone !== phoneDigits || !dupSettled) {
      return { kind: "checking", blocked: true, dup: null };
    }
    const d = dupQ.data?.phone.duplicate ?? null;
    return d
      ? { kind: "duplicate", blocked: true, dup: d }
      : { kind: "valid", blocked: false, dup: null };
  }, [
    phone,
    phoneDigits,
    phoneRawDigits,
    phoneBlur,
    submitAttempted,
    dupKeys.phone,
    dupSettled,
    dupQ.data,
  ]);

  const email_ = useMemo<{
    kind: FieldStatusKind;
    formatBad: boolean;
    dup: FieldCheckResult["duplicate"];
  }>(() => {
    if (emailTrim === "") return { kind: "none", formatBad: false, dup: null };
    if (!emailClientValid) {
      const show = emailBlur || submitAttempted || emailTrim.includes("@");
      return { kind: show ? "invalid" : "none", formatBad: true, dup: null };
    }
    if (dupKeys.email !== emailTrim.toLowerCase() || !dupSettled) {
      return { kind: "checking", formatBad: false, dup: null };
    }
    const d = dupQ.data?.email.duplicate ?? null;
    return d
      ? { kind: "duplicate", formatBad: false, dup: d }
      : { kind: "valid", formatBad: false, dup: null };
  }, [
    emailTrim,
    emailClientValid,
    emailBlur,
    submitAttempted,
    dupKeys.email,
    dupSettled,
    dupQ.data,
  ]);

  const readCustomer = (): FollowUpCustomer | null => {
    if (!formRef.current) return null;
    const fd = new FormData(formRef.current);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    if (!s("customer_name") || !s("phone")) return null;
    return {
      // UAT #5: the capture date is derived server-side from the agent's shift.
      // The client no longer sends one.
      date: "",
      full_name: s("customer_name"),
      phone: s("phone"),
      email: s("email"),
      address: s("address"),
      city: s("city"),
      state: s("state"),
      zip: s("zip"),
      debt_amount: Number(s("debt_amount").replace(/[^0-9.]/g, "")) || 0,
      credit,
      current_late: currentLate === "Current" || currentLate === "Late" ? currentLate : "",
      comment: s("comment"),
    };
  };

  const submitLead = async (c: FollowUpCustomer) => {
    if (!user || !closer) return;
    try {
      const res = await createLeadM.mutateAsync({
        customer_name: c.full_name,
        phone: c.phone,
        ...(c.email ? { email: c.email } : {}),
        ...(c.date ? { date: c.date } : {}),
        ...(c.address ? { address: c.address } : {}),
        ...(c.city ? { city: c.city } : {}),
        ...(c.state ? { state: c.state } : {}),
        ...(c.zip ? { zip: c.zip } : {}),
        ...(c.debt_amount ? { debt_amount: c.debt_amount } : {}),
        ...(c.credit ? { credit: c.credit } : {}),
        ...(c.current_late ? { current_late: c.current_late } : {}),
        ...(c.comment ? { comment: c.comment } : {}),
        // canonical CL-##### code — the server re-authorises it against process
        assigned_closer_code: closer,
      });
      const ui = leadDtoToUi(res.lead);
      // §3 — the document is OPTIONAL. The lead is already saved; a failed
      // upload never rolls the lead back, it only warns.
      if (docFile) {
        try {
          await uploadDocM.mutateAsync({ lead_code: ui.lead_id, file: docFile });
        } catch (err) {
          toast.error(
            err instanceof Error
              ? `Lead created, but the document upload failed: ${err.message}`
              : "Lead created, but the document upload failed.",
          );
        }
      }
      setCreatedLead(ui);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the lead");
    }
  };

  const submitFollowUp = async (c: FollowUpCustomer) => {
    if (!user || !fuDate || !fuTime) return;
    try {
      const res = await createFuM.mutateAsync({
        full_name: c.full_name,
        phone: c.phone,
        ...(c.email ? { email: c.email } : {}),
        ...(c.address ? { address: c.address } : {}),
        ...(c.city ? { city: c.city } : {}),
        ...(c.state ? { state: c.state } : {}),
        ...(c.zip ? { zip: c.zip } : {}),
        ...(c.debt_amount ? { debt_amount: c.debt_amount } : {}),
        ...(c.credit ? { credit: c.credit } : {}),
        ...(c.current_late ? { current_late: c.current_late } : {}),
        ...(c.date ? { date: c.date } : {}),
        scheduled_date: fuDate,
        scheduled_time: fuTime,
        ...(fuComment || c.comment ? { comment: fuComment || c.comment } : {}),
      });
      const ui = fuDtoToUi(res.followUp);
      toast("✅ Follow-up scheduled", {
        description: `${ui.customer_name} · ${displayDateTime(ui.scheduled_at)}`,
      });
      setCreatedFu(ui);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not schedule the follow-up");
    }
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setSubmitAttempted(true);

    // Inline gate — the server ALSO re-validates + re-checks the duplicate.
    if (phoneDigits === null) {
      toast.error(
        phone.trim() === ""
          ? "Phone number is required."
          : "Enter a valid US phone number before submitting.",
      );
      formRef.current?.querySelector<HTMLInputElement>("#phone")?.focus();
      return;
    }
    if (phone_.dup) {
      toast.error("This phone number already has a lead — duplicate leads are not allowed.");
      return;
    }
    if (email_.formatBad) {
      toast.error("The email address is not valid. Clear it or fix the format.");
      formRef.current?.querySelector<HTMLInputElement>("#email")?.focus();
      return;
    }

    const c = readCustomer();
    if (!c) return;
    if (action === "lead") void submitLead(c);
    else if (action === "followup") void submitFollowUp(c);
  };

  const reset = () => {
    setCreatedLead(null);
    setCreatedFu(null);
    setAction("");
    setPhone("");
    setEmail("");
    setPhoneBlur(false);
    setEmailBlur(false);
    setSubmitAttempted(false);
    setDupKeys({ phone: null, email: null });
    setCredit("");
    setCurrentLate("");
    setCloser("");
    setDocFile(null);
    if (docInputRef.current) docInputRef.current.value = "";
    setFuDate("");
    setFuTime("");
    setFuComment("");
    formRef.current?.reset();
  };

  const ownerLabel = user ? `${user.name} — ${user.role === "closer" ? "Closer" : "Agent"}` : "you";
  // phone must be a valid US number with no known duplicate; email (optional)
  // must not be malformed. An email DUPLICATE is a warning, not a blocker.
  const contactOk = phoneDigits !== null && !phone_.dup && !email_.formatBad;
  const canSubmit =
    contactOk &&
    (action === "lead"
      ? Boolean(closer)
      : action === "followup"
        ? Boolean(fuDate && fuTime)
        : false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New customer"
        description="Capture the customer's details once. Then choose what to do with them — create a Lead and transfer it to a Closer, or schedule your own follow-up callback."
      />

      <form ref={formRef} className="mx-auto max-w-2xl space-y-6" onSubmit={submit}>
        <SectionCard
          title="Customer information"
          description="Copy the customer's details from the dialer. The same information is used whether this becomes a Lead or a follow-up."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Capture date</Label>
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-sm font-medium">
                {shiftDateIST()} · your operational shift (IST)
              </p>
              <p className="text-xs text-muted-foreground">
                Set automatically from your assigned shift — it cannot be changed.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" name="customer_name" placeholder="Enter customer name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">
                Phone number (US) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="phone"
                name="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setPhoneBlur(true)}
                placeholder="e.g. (305) 555-0123"
                inputMode="tel"
                aria-invalid={phone_.kind === "invalid" || phone_.kind === "duplicate"}
                required
              />
              {phone_.kind === "none" ? (
                <p className="text-xs text-muted-foreground">
                  10-digit US number, or +1 followed by 10 digits.
                </p>
              ) : null}
              <FieldStatus
                kind={phone_.kind}
                invalidMsg={
                  phone.trim() === ""
                    ? "Phone number is required."
                    : "Enter a valid US phone number — 10 digits, or +1 followed by 10 digits."
                }
                dup={phone_.dup}
                tone="error"
                label="phone"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">
                Email <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="email"
                name="email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailBlur(true)}
                placeholder="Enter email address"
                autoComplete="off"
                inputMode="email"
                aria-invalid={email_.kind === "invalid"}
              />
              <FieldStatus
                kind={email_.kind}
                invalidMsg="That email address doesn't look valid."
                dup={email_.dup}
                tone="warning"
                label="email"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Street address</Label>
              <Input id="address" name="address" placeholder="Enter street address" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" placeholder="Enter city" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="state">State</Label>
                {user?.process === "US" ? (
                  <select
                    id="state"
                    name="state"
                    defaultValue=""
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Select state…</option>
                    {US_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input id="state" name="state" placeholder="State / province" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zip">ZIP</Label>
                <Input
                  id="zip"
                  name="zip"
                  placeholder={user?.process === "US" ? "e.g. 02108" : "Postal code"}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={10}
                  pattern="\d{5}(-\d{4})?"
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.value = sanitizeZip(el.value);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="debt">Debt amount</Label>
              <Input id="debt" name="debt_amount" placeholder="Enter amount" inputMode="numeric" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="credit">Credit status</Label>
                <Select value={credit} onValueChange={setCredit}>
                  <SelectTrigger id="credit">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Excellent", "Good", "Fair", "Poor"].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cl">Current debts</Label>
                <Select value={currentLate} onValueChange={setCurrentLate}>
                  <SelectTrigger id="cl">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Current">Current</SelectItem>
                    <SelectItem value="Late">Late</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="comment">Comments / notes</Label>
              <Textarea
                id="comment"
                name="comment"
                rows={4}
                placeholder="What did the customer say on the call?"
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Action"
          description="Choose what happens next. The customer information above stays attached either way."
        >
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="action">Select Lead or Follow-up</Label>
              <Select value={action} onValueChange={(v) => setAction(v as Action)}>
                <SelectTrigger id="action">
                  <SelectValue placeholder="Select an action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead — transfer this customer to a Closer</SelectItem>
                  <SelectItem value="followup">Follow-up — schedule my own callback</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {action === "" ? (
              <p className="rounded-lg border border-dashed border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
                Pick an action to continue. <strong>Lead</strong> creates a customer record and
                transfers it to a Closer — you won&apos;t be able to edit it afterwards.{" "}
                <strong>Follow-up</strong> keeps the customer with you and schedules a callback you
                own.
              </p>
            ) : null}

            {action === "lead" ? (
              <div className="space-y-4 rounded-lg border border-border bg-secondary/20 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="closer">Transfer to Closer</Label>
                  <Select value={closer} onValueChange={setCloser}>
                    <SelectTrigger id="closer">
                      <SelectValue placeholder="Select Closer" />
                    </SelectTrigger>
                    <SelectContent>
                      {closers.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name} · {c.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead_doc">Supporting Document (optional)</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      onClick={() => docInputRef.current?.click()}
                    >
                      {docFile ? "Change file" : "Choose File"}
                    </Button>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {docFile ? docFile.name : "No file chosen"}
                    </span>
                    {docFile ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-lg text-xs"
                        onClick={() => {
                          setDocFile(null);
                          if (docInputRef.current) docInputRef.current.value = "";
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <input
                    ref={docInputRef}
                    id="lead_doc"
                    type="file"
                    className="hidden"
                    accept={LEAD_DOC_ACCEPT}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (f && f.size > LEAD_DOC_MAX_BYTES) {
                        toast.error("That file is larger than the 10 MB limit.");
                        e.target.value = "";
                        return;
                      }
                      setDocFile(f);
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    PDF or image (PNG/JPEG/WebP), up to 10 MB. Only people authorised for this lead
                    can open it.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  The Lead is created with a unique Lead ID, transferred to the selected Closer, and
                  becomes read-only for you.
                </p>
              </div>
            ) : null}

            {action === "followup" ? (
              <div className="space-y-4 rounded-lg border border-border bg-secondary/20 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="fu_date">Follow-up date</Label>
                    <Input
                      id="fu_date"
                      type="date"
                      value={fuDate}
                      min={todayIST()}
                      onChange={(e) => setFuDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fu_time">Follow-up time (IST)</Label>
                    <Input
                      id="fu_time"
                      type="time"
                      value={fuTime}
                      onChange={(e) => setFuTime(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fu_comment">Follow-up comment / reason</Label>
                  <Textarea
                    id="fu_comment"
                    rows={3}
                    value={fuComment}
                    onChange={(e) => setFuComment(e.target.value)}
                    placeholder="e.g. Customer interested but busy. Requested callback on this date."
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  This callback is yours — owner <strong>{ownerLabel}</strong>. You&apos;ll get
                  in-app reminders 15, 3 and 1 minutes before, and it appears on your Follow-ups
                  list and calendar.
                </p>
              </div>
            ) : null}
          </div>
        </SectionCard>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!canSubmit || busy}
            className="rounded-lg px-6 py-5 text-base font-semibold"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : action === "followup" ? (
              "Schedule Follow-up"
            ) : (
              "Create Lead"
            )}
          </Button>
        </div>
      </form>

      <Dialog open={success} onOpenChange={(v) => !v && reset()}>
        <DialogContent className="max-w-sm rounded-2xl text-center">
          <div className="py-4">
            <span
              className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/12 text-success"
              aria-hidden
            >
              <CheckCircle2 className="h-6 w-6" />
            </span>

            {createdLead ? (
              <>
                <h2 className="mt-4 font-display text-xl font-bold">Lead created</h2>
                <div className="mt-3 flex justify-center">
                  <LeadIdChip id={createdLead.lead_id} />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {createdLead.customer_name} · transferred to {createdLead.assigned_closer}
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  <Button asChild className="rounded-lg">
                    <Link to="/leads">Go to my Leads</Link>
                  </Button>
                  <Button variant="ghost" className="rounded-lg" onClick={reset}>
                    Add another customer
                  </Button>
                </div>
              </>
            ) : createdFu ? (
              <>
                <h2 className="mt-4 font-display text-xl font-bold">Follow-up scheduled</h2>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {createdFu.follow_up_id}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {createdFu.customer_name} · {displayDateTime(createdFu.scheduled_at)}
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  <Button asChild className="rounded-lg">
                    <Link
                      to="/followups/$followUpId"
                      params={{ followUpId: createdFu.follow_up_id }}
                    >
                      Open follow-up
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-lg">
                    <Link to="/followups">Go to my Follow-ups</Link>
                  </Button>
                  <Button variant="ghost" className="rounded-lg" onClick={reset}>
                    Add another customer
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
