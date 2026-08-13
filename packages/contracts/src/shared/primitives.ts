import { z } from "zod";

export const IdentifierDtoSchema = z.string().min(1);
export const IsoDateTimeDtoSchema = z.iso.datetime({ offset: true });
export const LocaleDtoSchema = z.enum(["en-GB", "de-DE"]);
export const ReviewFormatLocaleDtoSchema = z.enum(["en-GB", "de-DE", "any"]);
export const ConfigurationScopeDtoSchema = z.enum(["platform", "tenant", "location"]);

export type LocaleDto = z.infer<typeof LocaleDtoSchema>;
export type ConfigurationScopeDto = z.infer<typeof ConfigurationScopeDtoSchema>;

