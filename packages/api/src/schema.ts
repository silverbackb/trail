import { z } from "zod";

export const TouchpointSchema = z.object({
  visitor_id: z.string().uuid(),
  account_id: z.string().min(1),
  channel: z.object({
    utm_source:   z.string().nullable(),
    utm_medium:   z.string().nullable(),
    utm_campaign: z.string().nullable(),
    utm_term:     z.string().nullable(),
    utm_content:  z.string().nullable(),
    gclid:        z.string().nullable(),
    fbclid:       z.string().nullable(),
    referrer:     z.string().nullable(),
    referrer_type: z.enum(["paid_search", "paid_social", "organic_search", "organic_social", "email", "referral", "direct"]),
    landing_url:  z.string(),
  }),
  hostname: z.string(),
});

export const ConvertSchema = z.object({
  visitor_id: z.string().uuid(),
  account_id: z.string().min(1),
  lead_id:    z.string().min(1),
});

export type Touchpoint = z.infer<typeof TouchpointSchema>;
