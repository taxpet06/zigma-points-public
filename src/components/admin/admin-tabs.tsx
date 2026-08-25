"use client"

import { useQuery } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
import { AdminUserTable } from "@/components/admin/user-table"
import { AdminApprovedEmailsTable } from "@/components/admin/approved-emails-table"
import { AdminTermsPanel } from "@/components/admin/terms-panel"
import { TaskCard } from "@/components/tasks/task-card"
import { CreateTaskModal } from "@/components/tasks/create-task-modal"
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

function AdminTasksPanel() {
  const trpc = useTRPC()
  const { data: tasks, isLoading } = useQuery(trpc.task.getTasks.queryOptions())

  if (isLoading) return <FeedSkeleton count={3} />

  return (
    <div className="space-y-4">
      {!tasks || tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No activities yet.</p>
      ) : (
        tasks.map((task, i) => (
          <TaskCard
            key={task.id}
            index={i}
            id={task.id}
            title={task.title}
            description={task.description}
            zpReward={task.zpReward}
            kind={task.kind}
            minBet={task.minBet}
            betsCloseAt={task.betsCloseAt}
            winningChoice={task.winningChoice}
            betSettled={task.betSettledAt !== null}
            mediaUrl={task.mediaUrl}
            images={task.images}
            createdAt={task.createdAt}
            admin={task.admin}
            replyCount={task._count.replies}
            canEdit
          />
        ))
      )}
    </div>
  )
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
      <TabsList className="w-full">
        <TabsTrigger value="users" className="flex-1">Users</TabsTrigger>
        <TabsTrigger value="tasks" className="flex-1">Activities</TabsTrigger>
        <TabsTrigger value="emails" className="flex-1">Sign-ups</TabsTrigger>
        <TabsTrigger value="terms" className="flex-1">Terms</TabsTrigger>
      </TabsList>

      <TabsContent value="users" className="mt-6">
        <AdminUsersPanel />
      </TabsContent>
      <TabsContent value="tasks" className="mt-6">
        <div className="flex justify-end mb-4">
          <CreateTaskModal />
        </div>
        <AdminTasksPanel />
      </TabsContent>
      <TabsContent value="emails" className="mt-6">
        <AdminApprovedEmailsPanel />
      </TabsContent>
      <TabsContent value="terms" className="mt-6">
        <AdminTermsPanel />
      </TabsContent>
    </Tabs>
  )
}
