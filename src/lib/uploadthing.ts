// Typed Uploadthing helpers.
// Source: docs.uploadthing.com/getting-started/appdir
//
// The prebuilt UploadButton/UploadDropzone generators are deliberately not exported:
// the avatar UI drives its own markup (see components/profile/avatar-upload.tsx) and
// needs hook-level access to upload state. Add them back if a surface wants the
// stock components.

import { generateReactHelpers } from "@uploadthing/react"
import type { OurFileRouter } from "@/app/api/uploadthing/core"

export const { useUploadThing } = generateReactHelpers<OurFileRouter>()
