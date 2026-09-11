// Uploadthing route handler — exposes GET and POST for the FileRouter.
// Source: docs.uploadthing.com/getting-started/appdir

import { createRouteHandler } from "uploadthing/next"
import { ourFileRouter } from "./core"

export const { GET, POST } = createRouteHandler({ router: ourFileRouter })
