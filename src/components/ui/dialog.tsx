"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, Maximize2, Minimize2 } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    // data-dialog-overlay is the hook globals.css uses to kill pull-to-refresh on <body>
    // while any dialog is open (Radix locks body scroll, but that alone does not stop the
    // browser's overscroll gesture). touch-none stops a drag on the dimmed backdrop from
    // scrolling the page behind it — safe because Overlay and Content are SIBLINGS inside
    // the portal, so this never affects scrolling within the dialog itself.
    data-dialog-overlay=""
    className={cn(
      "fixed inset-0 z-50 touch-none overscroll-none bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// Every dialog in the app renders through this: a centered card that the user can
// toggle to fullscreen via the maximize button (games, post creation, tasks — all
// identical). Maximized state lives here, so it resets to windowed each time the
// dialog reopens (Radix unmounts closed content — no manual reset needed).
//
// max-h uses dvh (dynamic viewport) so the card always fits the *visible* screen on
// mobile — even with browser chrome or the on-screen keyboard shrinking it — and
// overflow-y-auto lets tall content (e.g. the post creation form) scroll internally.
const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95 motion-reduce:active:scale-100"

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const [maximized, setMaximized] = React.useState(false)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // content-start is load-bearing: this is a grid, and in fullscreen the
          // container is a fixed 100dvh. Without it the implicit rows STRETCH to fill
          // that height, which is what made maximized game boards scale oddly.
          "fixed z-50 grid content-start gap-4 border bg-background shadow-lg outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          // dialog-scroll shows a slim scrollbar instead of hiding it. A hidden
          // scrollbar means nothing tells you the content scrolls and there is
          // nothing to grab on desktop — overscroll-contain stops a scroll that
          // reaches the end from chaining to the page behind the overlay.
          "overscroll-contain dialog-scroll",
          maximized
            ? // Fullscreen: caller className is intentionally dropped so a caller's
              // sm:max-w-* can't cap the width at ≥sm and shrink "fullscreen" to a card.
              "inset-0 h-[100dvh] w-full max-w-none overflow-y-auto p-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]"
            : cn(
                "left-[50%] top-[50%] w-full max-w-lg max-h-[calc(100dvh-2rem)] translate-x-[-50%] translate-y-[-50%] overflow-y-auto rounded-lg p-6",
                className,
              ),
        )}
        {...props}
      >
        {children}
        <div className="absolute right-4 top-4 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMaximized((m) => !m)}
            aria-label={maximized ? "Exit fullscreen" : "Fullscreen"}
            className={iconBtn}
          >
            {maximized ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <DialogPrimitive.Close className={iconBtn} aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
