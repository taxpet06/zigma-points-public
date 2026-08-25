import { describe, it, expect } from "vitest"
import { zpPriceSchema, createListingSchema, listingIdSchema } from "@/lib/validation/listing"
import { tradeOfferSchema } from "@/lib/validation/transfer"

describe("zpPriceSchema", () => {
  it("rejects 0", () => {
    expect(zpPriceSchema.safeParse(0).success).toBe(false)
  })

  it("rejects a negative price", () => {
    expect(zpPriceSchema.safeParse(-1).success).toBe(false)
  })

  it("rejects a fractional price", () => {
    expect(zpPriceSchema.safeParse(1.5).success).toBe(false)
  })

  it("rejects a price above 1,000,000", () => {
    expect(zpPriceSchema.safeParse(1_000_001).success).toBe(false)
  })

  it("accepts the lower and upper bounds", () => {
    expect(zpPriceSchema.safeParse(1).success).toBe(true)
    expect(zpPriceSchema.safeParse(1_000_000).success).toBe(true)
  })

  it("coerces the string '42' to the number 42", () => {
    const r = zpPriceSchema.safeParse("42")
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe(42)
  })
})

describe("createListingSchema", () => {
  const valid = { cosmeticPurchaseId: "copy-1", price: 100 }

  it("accepts a valid listing", () => {
    expect(createListingSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects an extra unknown key", () => {
    expect(createListingSchema.safeParse({ ...valid, extra: "nope" }).success).toBe(false)
  })

  it("rejects an empty cosmeticPurchaseId", () => {
    expect(createListingSchema.safeParse({ ...valid, cosmeticPurchaseId: "" }).success).toBe(false)
  })
})

describe("listingIdSchema", () => {
  it("accepts a listingId", () => {
    expect(listingIdSchema.safeParse({ listingId: "listing-1" }).success).toBe(true)
  })

  it("rejects an empty listingId", () => {
    expect(listingIdSchema.safeParse({ listingId: "" }).success).toBe(false)
  })
})

describe("tradeOfferSchema", () => {
  const valid = { recipientId: "u1", cosmeticPurchaseId: "copy-1", price: 100 }

  it("accepts a valid trade offer", () => {
    expect(tradeOfferSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects the same out-of-bound prices as zpPriceSchema", () => {
    expect(tradeOfferSchema.safeParse({ ...valid, price: 0 }).success).toBe(false)
    expect(tradeOfferSchema.safeParse({ ...valid, price: -1 }).success).toBe(false)
    expect(tradeOfferSchema.safeParse({ ...valid, price: 1.5 }).success).toBe(false)
    expect(tradeOfferSchema.safeParse({ ...valid, price: 1_000_001 }).success).toBe(false)
  })

  it("rejects an extra unknown key", () => {
    expect(tradeOfferSchema.safeParse({ ...valid, extra: "nope" }).success).toBe(false)
  })
})
