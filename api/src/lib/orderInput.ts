import { z } from 'zod';

/** A Ugandan mobile number, normalised to the 07XXXXXXXX form used at delivery. */
export const ugandanPhone = z.string().trim().min(10).max(32)
  .transform((phone) => phone.replace(/[\s()-]/g, '').replace(/^\+?256/, '0'))
  .refine((phone) => /^07\d{8}$/.test(phone), 'Enter a valid Ugandan phone number.');

export const guestShippingSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: ugandanPhone,
  address: z.string().trim().min(3).max(500),
  region: z.string().trim().min(1).max(100),
  district: z.string().trim().max(100).optional(),
  subCounty: z.string().trim().max(100).optional(),
  parish: z.string().trim().max(100).optional(),
  village: z.string().trim().max(100).optional(),
  /**
   * An optional pin from the browser's geolocation. It never replaces the
   * validated region/district above — the delivery is routed on those — it only
   * records where the buyer actually stood so the market can drop it nearer.
   * A point outside Uganda, or that no district outline contains, simply fails
   * the region/district guard like any other bad location.
   */
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  /** Accuracy radius in metres reported by the device, if it reported one. */
  accuracyM: z.number().int().nonnegative().max(100_000).optional(),
  locationSource: z.enum(['gps', 'manual']).optional(),
}).strict();

export const createOrderSchema = z.object({
  cartId: z.number().int().positive(),
  shipping: guestShippingSchema.optional(),
  /** Optional discount code; resolved against the server-side subtotal. */
  promoCode: z.string().trim().max(32).optional(),
}).strict();

export type GuestShipping = z.infer<typeof guestShippingSchema>;
