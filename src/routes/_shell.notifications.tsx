import { createFileRoute } from "@tanstack/react-router";
import { Bell, Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/officeverse/primitives";
import {
  markAllNotificationsRead,
  markNotificationRead,
  queueEmail,
} from "@/lib/officeverse/alerts";
import { renderShiftEmail } from "@/lib/officeverse/email-templates";
import { followUpsForNextShift, loadFollowUps } from "@/lib/officeverse/followups";
import { useNotifications, useOutbox } from "@/lib/officeverse/use-crm";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/notifications")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s["tab"] === "string" ? { tab: s["tab"] } : {},
  head: () => ({
    meta: [
      { title: "Notifications — TeleMaster India" },
      { name: "description", content: "Follow-up reminders, lead updates and the email outbox." },
    ],
  }),
  component: NotificationsPage,
});

const TABS = ["All", "Leads", "Follow-ups", "System", "Emails"] as const;

function NotificationsPage() {
  const { user } = useSession();
  const { tab } = Route.useSearch();
  const initialTab = TABS.includes(tab as (typeof TABS)[number]) ? tab! : "All";
  const notifications = useNotifications();
  const outbox = useOutbox();
  const [openMail, setOpenMail] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Follow-up reminders (15 / 3 / 1 minute), lead updates, and every email the workflow queued."
        actions={
          <Button
            variant="outline"
            className="rounded-lg"
            onClick={() => {
              markAllNotificationsRead();
              toast("All notifications marked as read");
            }}
          >
            Mark all as read
          </Button>
        }
      />

      <Tabs defaultValue={initialTab}>
        <TabsList className="rounded-lg p-1">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="rounded-md px-5 font-semibold">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.filter((t) => t !== "Emails").map((t) => {
          const items = notifications.filter((n) => t === "All" || n.category === t);
          return (
            <TabsContent key={t} value={t} className="mt-6 space-y-3">
              {items.length === 0 ? (
                <EmptyState
                  emoji="🔕"
                  title="All quiet."
                  message="Nothing in this category right now."
                />
              ) : (
                items.map((n) => (
                  <Card
                    key={n.id}
                    className={cn(
                      "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 rounded-xl border-border bg-card p-4 shadow-sm",
                      n.unread && "border-l-2 border-l-primary",
                    )}
                  >
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary"
                      aria-hidden
                    >
                      <Bell className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{n.title}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {n.category} · {n.time}
                      </p>
                    </div>
                    {n.unread ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 rounded-lg"
                        onClick={() => markNotificationRead(n.id)}
                      >
                        Mark read
                      </Button>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">Read</span>
                    )}
                  </Card>
                ))
              )}
            </TabsContent>
          );
        })}

        <TabsContent value="Emails" className="mt-6 space-y-3">
          <Card className="rounded-xl border-warning/40 bg-warning/10 p-4 text-xs shadow-sm">
            <span className="font-semibold text-warning">Not delivered.</span> This build has no
            mail provider. Every email the workflow would send — the single Closer follow-up
            reminder and the 4-hours-before-shift summary — is rendered in full and{" "}
            <strong>queued</strong> here, de-duplicated (one follow-up → one email; one shift → one
            email). Forward this outbox to a transactional email service (Resend / SES / Postmark)
            from a backend job to actually send.
          </Card>
          {user && (user.role === "agent" || user.role === "closer") ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                const items = followUpsForNextShift(loadFollowUps(), user);
                const mail = renderShiftEmail(user, items);
                queueEmail(mail, { force: true });
                toast("Shift summary rendered and queued (not sent)");
              }}
            >
              <Mail className="mr-1.5 h-4 w-4" /> Preview my upcoming-shift summary
            </Button>
          ) : null}

          {outbox.length === 0 ? (
            <EmptyState
              emoji="📭"
              title="Outbox is empty."
              message="Closer and shift emails appear here as the workflow generates them."
            />
          ) : (
            outbox.map((m) => (
              <Card key={m.id} className="rounded-xl border-border bg-card p-4 shadow-sm">
                <button
                  type="button"
                  onClick={() => setOpenMail(openMail === m.id ? null : m.id)}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 text-left"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
                    <Mail className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{m.subject}</span>
                      <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                        Ready to send
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      To: {m.to_name} &lt;{m.to}&gt;
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {m.kind === "closer-followup" ? "Closer follow-up reminder" : "Shift summary"}{" "}
                      · queued {new Date(m.queued_at).toLocaleString()}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-accent">
                    {openMail === m.id ? "Hide" : "Read"}
                  </span>
                </button>
                {openMail === m.id ? (
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/40 p-3 text-xs">
                    {m.body}
                  </pre>
                ) : null}
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
