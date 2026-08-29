import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/officeverse/primitives";
import { queueEmail } from "@/lib/officeverse/alerts";
import { renderShiftEmail } from "@/lib/officeverse/email-templates";
import { followUpsForNextShift, loadFollowUps } from "@/lib/officeverse/followups";
import { notificationHref } from "@/lib/officeverse/notification-link";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationList,
} from "@/lib/officeverse/use-notifications";
import { useOutbox } from "@/lib/officeverse/use-crm";
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
type TabName = (typeof TABS)[number];
const PAGE_SIZE = 20;

/** Client-side category filter over the already-bounded server page. */
function inCategory(type: string, tab: TabName): boolean {
  if (tab === "All") return true;
  if (tab === "Leads") return type.startsWith("lead");
  if (tab === "Follow-ups") return type.startsWith("followup");
  if (tab === "System") return !type.startsWith("lead") && !type.startsWith("followup");
  return false;
}

function NotificationsPage() {
  const { user } = useSession();
  const { tab } = Route.useSearch();
  const initialTab: TabName = TABS.includes(tab as TabName) ? (tab as TabName) : "All";

  const [page, setPage] = useState(1);
  const list = useNotificationList({ page, pageSize: PAGE_SIZE });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const outbox = useOutbox();
  const [openMail, setOpenMail] = useState<string | null>(null);

  const result = list.data;
  const notifications = result?.notifications ?? [];
  const totalPages = result?.totalPages ?? 1;
  const unread = result?.unread ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Lead updates, follow-up activity, and every email the workflow queued."
        actions={
          <Button
            variant="outline"
            className="rounded-lg"
            disabled={unread === 0 || markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, {
                onSuccess: () => toast("All notifications marked as read"),
                onError: () => toast.error("Couldn't mark all as read — please try again"),
              })
            }
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
          const items = notifications.filter((n) => inCategory(n.type, t));
          return (
            <TabsContent key={t} value={t} className="mt-6 space-y-3">
              {list.isLoading ? (
                <Card className="rounded-xl border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
                  Loading notifications…
                </Card>
              ) : list.isError ? (
                <Card className="rounded-xl border-destructive/40 bg-destructive/5 p-6 text-center text-sm shadow-sm">
                  <p className="font-semibold text-destructive">Couldn't load notifications.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 rounded-lg"
                    onClick={() => list.refetch()}
                  >
                    Retry
                  </Button>
                </Card>
              ) : items.length === 0 ? (
                <EmptyState
                  emoji="🔕"
                  title="All quiet."
                  message="Nothing in this category right now."
                />
              ) : (
                items.map((n) => {
                  const href = notificationHref(n);
                  return (
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
                        <p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {n.type} · {new Date(n.created_at).toLocaleString()}
                        </p>
                        {href ? (
                          <Link
                            {...href}
                            className="mt-1 inline-block text-xs font-semibold text-primary hover:underline"
                            onClick={() => {
                              if (n.unread) markRead.mutate(n.id);
                            }}
                          >
                            Open {n.related_entity_code}
                          </Link>
                        ) : null}
                      </div>
                      {n.unread ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0 rounded-lg"
                          disabled={markRead.isPending}
                          onClick={() =>
                            markRead.mutate(n.id, {
                              onError: () =>
                                toast.error("Couldn't mark as read — please try again"),
                            })
                          }
                        >
                          Mark read
                        </Button>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">Read</span>
                      )}
                    </Card>
                  );
                })
              )}

              {!list.isLoading && !list.isError && totalPages > 1 ? (
                <div className="flex items-center justify-between pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </TabsContent>
          );
        })}

        <TabsContent value="Emails" className="mt-6 space-y-3">
          <Card className="rounded-xl border-warning/40 bg-warning/10 p-4 text-xs shadow-sm">
            <span className="font-semibold text-warning">Legacy preview.</span> This build has no
            mail provider. The email outbox below is a client-side render of what the workflow would
            send; the DB-backed email queue (Phase 5) is the real pipeline and is drained by a
            future worker.
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
