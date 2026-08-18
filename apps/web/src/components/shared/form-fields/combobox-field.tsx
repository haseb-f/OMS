import type { ReactNode } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import {
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from "@/components/ui/form";
import { EntityCombobox } from "@/components/shared/entity-combobox";

export function ComboboxFormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TItem,
>({
  control,
  name,
  label,
  description,
  required,
  optional,
  disabled,
  items,
  getId,
  getTitle,
  getSubtitle,
  getSearchText,
  placeholder,
  searchPlaceholder,
  emptyText,
  allowClear,
  icon,
  subtitleDir,
}: {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  description?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  items: TItem[];
  getId: (item: TItem) => string;
  getTitle: (item: TItem) => string;
  getSubtitle?: (item: TItem) => ReactNode;
  getSearchText?: (item: TItem) => string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  icon?: ReactNode;
  subtitleDir?: "ltr" | "rtl";
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const selected = items.find((item) => getId(item) === field.value) ?? null;

        return (
          <FormItem>
            <FormLabel required={required} optional={optional}>
              {label}
            </FormLabel>
            <BoundEntityCombobox
              items={items}
              value={selected}
              onChange={(item) => field.onChange(item ? getId(item) : "")}
              getId={getId}
              getTitle={getTitle}
              getSubtitle={getSubtitle}
              getSearchText={getSearchText}
              placeholder={placeholder}
              searchPlaceholder={searchPlaceholder}
              emptyText={emptyText}
              disabled={disabled}
              allowClear={allowClear}
              icon={icon}
              error={!!fieldState.error}
              subtitleDir={subtitleDir}
            />
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

function BoundEntityCombobox<T>(props: {
  items: T[];
  value: T | null;
  onChange: (item: T | null) => void;
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  getSubtitle?: (item: T) => ReactNode;
  getSearchText?: (item: T) => string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  allowClear?: boolean;
  icon?: ReactNode;
  error?: boolean;
  subtitleDir?: "ltr" | "rtl";
}) {
  const { formItemId, error } = useFormField();

  return <EntityCombobox {...props} id={formItemId} error={props.error || !!error} />;
}
