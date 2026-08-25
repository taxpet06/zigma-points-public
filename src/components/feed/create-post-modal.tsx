"use client"

import { useState, useEffect, useRef } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Coins } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { createPostSchema } from "@/lib/validation/post"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { UserMultiAutocomplete } from "@/components/feed/user-multi-autocomplete"
import { UserPickerView } from "@/components/feed/user-picker-view"
import { ImageUploadField } from "@/components/ui/image-upload-field"
import { BetPoolForm } from "@/components/tasks/bet-pool-form"

type CreatePostValues = z.infer<typeof createPostSchema>

export function CreatePostModal({ trigger }: { trigger?: React.ReactNode } = {}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"form" | "picker">("form")
  const [uploading, setUploading] = useState(false)
  // A betting pool isn't a Post at all (it's a BET Task), so it can't ride the post
  // form's type field — it swaps the body instead, keeping the toggle row above it.
  const [isBet, setIsBet] = useState(false)

  // The dialog is the scroll container, and switching between the form and the people
  // picker swaps the content without touching scrollTop — so opening the picker from a
  // scrolled-down form dropped you in already scrolled past its search field. Reset to the
  // top of whichever view just became visible.
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [view])

  const form = useForm<CreatePostValues>({
    // z.coerce.number() gives the resolver an unknown input type; cast to align generics
    resolver: zodResolver(createPostSchema) as Resolver<CreatePostValues>,
    defaultValues: { type: "AWARD", targetUserIds: [], zpAmount: 1, title: "", explanation: "", images: [] },
  })

  const createPost = useMutation(
    trpc.post.createPost.mutationOptions({
      onSuccess: () => {
        setOpen(false)
        form.reset()
        void queryClient.invalidateQueries(trpc.post.getFeed.queryFilter())
      },
      onError: () => {
        form.setError("root", { message: "Failed to create post. Please try again." })
      },
    })
  )

  function handleOpenChange(v: boolean) {
    if (!v) {
      form.reset()
      setView("form")
      setIsBet(false)
    }
    setOpen(v)
  }

  function onSubmit(data: CreatePostValues) {
    createPost.mutate(data)
  }

  const postType = form.watch("type")
  const isRegular = postType === "REGULAR"
  const zpAmount = Number(form.watch("zpAmount"))
  // Author earns back the post's ZP, capped at 3 (mirrors AUTHOR_REWARD_CAP in settlement.ts).
  const rewardLabel =
    Number.isFinite(zpAmount) && zpAmount > 0 ? `${Math.min(zpAmount, 3)} ZP` : "ZP"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="default" className="w-full sm:w-auto">
            Create Post
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        ref={contentRef}
        className="sm:max-w-lg"
        onInteractOutside={(e) => {
          // The autocomplete dropdown portals to document.body. Radix's
          // onInteractOutside fires on pointerdown — before onClick — and treats the
          // portaled dropdown as "outside" the dialog. e.target here is the
          // DismissableLayer div (not the clicked element), so contains() is useless.
          // Instead: if the listbox node is currently in the DOM, the dropdown is open
          // and any click should be allowed to complete before the dialog can close.
          if (document.getElementById("user-search-listbox") !== null) {
            e.preventDefault()
          }
        }}
      >
        {view === "picker" ? (
          <UserPickerView
            value={form.getValues("targetUserIds") ?? []}
            onConfirm={(ids) => {
              form.setValue("targetUserIds", ids, { shouldValidate: true, shouldDirty: true })
              setView("form")
            }}
            onBack={() => setView("form")}
          />
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>{isBet ? "Create Betting Pool" : "Create Post"}</DialogTitle>
        </DialogHeader>

        {/* Field 1: what to create — Award/Deduct/Regular post, or a betting pool.
            Four across on a phone would give ~80px chips; 2x2 keeps each one thumb-sized. */}
        <div role="group" aria-label="Post type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button
            type="button"
            variant={!isBet && postType === "AWARD" ? "default" : "outline"}
            className="w-full px-2 text-xs sm:text-sm"
            aria-pressed={!isBet && postType === "AWARD"}
            onClick={() => {
              setIsBet(false)
              form.setValue("type", "AWARD")
            }}
          >
            Award
          </Button>
          <Button
            type="button"
            variant={!isBet && postType === "DEDUCT" ? "destructive" : "outline"}
            className="w-full px-2 text-xs sm:text-sm"
            aria-pressed={!isBet && postType === "DEDUCT"}
            onClick={() => {
              setIsBet(false)
              form.setValue("type", "DEDUCT")
            }}
          >
            Deduct
          </Button>
          <Button
            type="button"
            variant={!isBet && postType === "REGULAR" ? "default" : "outline"}
            className="w-full px-2 text-xs sm:text-sm"
            aria-pressed={!isBet && postType === "REGULAR"}
            onClick={() => {
              setIsBet(false)
              form.setValue("type", "REGULAR")
              // Reset what the Regular form no longer shows. Without this, a target list or a
              // cleared ZP field left over from an Award draft stays in form state and fails
              // validation on a field the user can no longer see — an unexplainable dead
              // Submit button. (The server normalises these too; this is so the FORM agrees.)
              form.setValue("targetUserIds", [], { shouldValidate: true })
              form.setValue("zpAmount", 1, { shouldValidate: true })
              form.clearErrors(["targetUserIds", "zpAmount", "explanation"])
            }}
          >
            Regular
          </Button>
          <Button
            type="button"
            variant={isBet ? "default" : "outline"}
            className="w-full px-2 text-xs sm:text-sm"
            aria-pressed={isBet}
            onClick={() => setIsBet(true)}
          >
            Betting Pool
          </Button>
        </div>

        {isBet ? (
          <BetPoolForm onDone={() => handleOpenChange(false)} />
        ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* What happens next — sets expectations before they fill the form. */}
            <p className="text-xs text-muted-foreground text-pretty">
              {postType === "AWARD"
                ? "Members vote Pass or Fail. If it passes, they get the ZP."
                : postType === "DEDUCT"
                  ? "Members vote Pass or Fail. If it passes, the ZP is taken from them."
                  : "Just a post. No voting, no ZP — it goes straight to the feed."}
            </p>

            {/* Field 2: Target users (one or more) — a Regular post nominates nobody. */}
            {!isRegular && (
            <FormField
              control={form.control}
              name="targetUserIds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target users</FormLabel>
                  <FormControl>
                    <UserMultiAutocomplete
                      value={field.value ?? []}
                      onChange={field.onChange}
                      onOpenPicker={() => setView("picker")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            )}

            {/* Field 3: Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={isRegular ? "What's on your mind?" : "What are you nominating them for?"}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Field 4: Explanation */}
            <FormField
              control={form.control}
              name="explanation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isRegular ? "Description (optional)" : "Explanation"}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      placeholder={isRegular ? "Say more, if you want…" : "Describe what happened…"}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Field 4b: Image attachments (optional) */}
            <FormField
              control={form.control}
              name="images"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Images</FormLabel>
                  <FormControl>
                    <ImageUploadField value={field.value ?? []} onChange={field.onChange} onUploadingChange={setUploading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Field 5: ZP Amount — and the reward reminder that only makes sense with it.
                A Regular post moves no ZP at all, so both are gone rather than zeroed. */}
            {!isRegular && (
            <>
            <FormField
              control={form.control}
              name="zpAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ZP amount</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} placeholder="1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Friendly reward reminder — a passing post earns its author the ZP back. */}
            <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground text-pretty">
              <Coins className="h-4 w-4 shrink-0 text-foreground/70" aria-hidden="true" />
              <span>
                If your post passes, you&apos;ll earn{" "}
                <span className="font-medium text-foreground">{rewardLabel}</span> back.
              </span>
            </div>
            </>
            )}

            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            {uploading && (
              <p role="alert" className="text-sm font-medium text-destructive">
                Some photos haven&apos;t fully loaded yet — wait for them to finish before submitting.
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { form.reset(); setOpen(false) }}
              >
                Discard
              </Button>
              <Button type="submit" variant="default" disabled={createPost.isPending || uploading}>
                {createPost.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Submit Post"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
        )}
        </>
        )}
      </DialogContent>
    </Dialog>
  )
}
