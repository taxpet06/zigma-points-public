"use client"

import { useQuery } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
import { AdminUserTable } from "@/components/admin/user-table"
import { AdminApprovedEmailsTable } from "@/components/admin/approved-emails-table"
import { AdminTermsPanel } from "@/components/admin/terms-panel"
import { AdminPodiumPanel } from "@/components/admin/podium-panel"
import { AdminDowntimePanel } from "@/components/admin/downtime-panel"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

function AdminUsersPanel() {
  const trpc = useTRPC()
  const { data: users, isLoading } = useQuery(trpc.admin.getAllUsers.queryOptions())

  if (isLoading) return <FeedSkeleton count={3} />
  if (!users || users.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No users found.</p>
  }

  return <AdminUserTable users={users} />
}

function AdminApprovedEmailsPanel() {
  const trpc = useTRPC()
  const { data: emails, isLoading } = useQuery(trpc.admin.listApprovedEmails.queryOptions())

  if (isLoading) return <FeedSkeleton count={3} />

  return <AdminApprovedEmailsTable emails={emails ?? []} />
}

export function AdminTabs() {
  return (
    <Tabs defaultValue="users" className="mt-8">
      <TabsList className="flex w-full flex-wrap">
        <TabsTrigger value="users" className="flex-1">Users</TabsTrigger>
        <TabsTrigger value="podium" className="flex-1">Podium</TabsTrigger>
        <TabsTrigger value="emails" className="flex-1">Sign-ups</TabsTrigger>
        <TabsTrigger value="terms" className="flex-1">Terms</TabsTrigger>
        <TabsTrigger value="downtime" className="flex-1">Downtime</TabsTrigger>
      </TabsList>

      <TabsContent value="users" className="mt-6">
        <AdminUsersPanel />
      </TabsContent>
      <TabsContent value="podium" className="mt-6">
        <AdminPodiumPanel />
      </TabsContent>
      <TabsContent value="emails" className="mt-6">
        <AdminApprovedEmailsPanel />
      </TabsContent>
      <TabsContent value="terms" className="mt-6">
        <AdminTermsPanel />
      </TabsContent>
      <TabsContent value="downtime" className="mt-6">
        <AdminDowntimePanel />
      </TabsContent>
    </Tabs>
  )
}
