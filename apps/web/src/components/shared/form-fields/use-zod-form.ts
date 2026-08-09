import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldValues, type UseFormProps } from "react-hook-form";
import type { ZodType } from "zod";

/**
 * The one reusable form engine's entry point: `useForm` pre-wired to a Zod
 * schema via `zodResolver`, so every business form defines validation once
 * (as a schema) instead of hand-rolling field-level checks.
 */
export function useZodForm<TFieldValues extends FieldValues>(
  schema: ZodType<TFieldValues>,
  options?: Omit<UseFormProps<TFieldValues>, "resolver">,
) {
  // zod's `unknown` input generic and react-hook-form's `FieldValues` bound
  // don't line up exactly across zod/resolver versions — safe to bridge with
  // `any` here because `schema` is already typed `ZodType<TFieldValues>` by
  // this function's own signature; the resolver's runtime behavior is
  // unaffected.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolver = zodResolver(schema as any) as UseFormProps<TFieldValues>["resolver"];

  return useForm<TFieldValues>({
    ...options,
    resolver,
  });
}
