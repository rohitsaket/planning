"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useAuthStore } from "@/stores/auth-store";
import type { RoleRow, ScopeOptions } from "./shared";

/**
 * Role choice for an account: active custom roles only (Super Admin is never offered). The
 * server checks every role again, including that a caller who is not a Super Admin holds
 * every permission the chosen roles carry.
 */
export function RolePicker({
  roles,
  value,
  onChange,
  idPrefix,
}: {
  roles: RoleRow[];
  value: string[];
  onChange: (codes: string[]) => void;
  idPrefix: string;
}) {
  const offered = roles.filter((r) => r.status === "ACTIVE");
  if (offered.length === 0) return <p className="text-xs text-muted-foreground">No roles yet. Create one on the Permissions tab first.</p>;
  const toggle = (code: string, on: boolean) => onChange(on ? [...value, code] : value.filter((c) => c !== code));
  return (
    <fieldset className="space-y-1.5">
      <legend className="sr-only">Roles</legend>
      {offered.map((r) => {
        const id = `${idPrefix}-role-${r.code}`;
        return (
          <label key={r.code} htmlFor={id} className="flex items-start gap-2 rounded-md border border-border/70 px-2.5 py-2 text-xs hover:bg-muted/40">
            <Checkbox id={id} checked={value.includes(r.code)} onCheckedChange={(c) => toggle(r.code, c === true)} className="mt-0.5" />
            <span className="min-w-0">
              <span className="font-semibold text-foreground">{r.name}</span>
              <span className="block text-muted-foreground">{r.description || `${r.permissions.length} permissions`}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * Country and lab scope from the registered values only. "All" is offered for a dimension
 * only when the signed-in user is unrestricted in it — nobody can grant wider than they hold,
 * and the server enforces the same rule.
 */
export function ScopePicker({
  options,
  value,
  onChange,
  idPrefix,
}: {
  options: ScopeOptions;
  value: { countries: string[]; labs: string[] };
  onChange: (next: { countries: string[]; labs: string[] }) => void;
  idPrefix: string;
}) {
  const own = useAuthStore((s) => s.user?.accessScope);
  const allCountriesAllowed = !own || own.countries === null;
  const allLabsAllowed = !own || own.labs === null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <ScopeDimension
        label="Countries"
        idPrefix={`${idPrefix}-country`}
        allAllowed={allCountriesAllowed}
        items={options.countries.map((c) => ({ value: c.code, label: c.name && c.name !== c.code ? `${c.code} · ${c.name}` : c.code }))}
        selected={value.countries}
        onChange={(countries) => onChange({ ...value, countries })}
      />
      <ScopeDimension
        label="Labs"
        idPrefix={`${idPrefix}-lab`}
        allAllowed={allLabsAllowed}
        items={options.labs.map((l) => ({ value: l, label: l }))}
        selected={value.labs}
        onChange={(labs) => onChange({ ...value, labs })}
      />
    </div>
  );
}

function ScopeDimension({
  label,
  idPrefix,
  allAllowed,
  items,
  selected,
  onChange,
}: {
  label: string;
  idPrefix: string;
  allAllowed: boolean;
  items: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const all = selected.length === 0;
  return (
    <fieldset className="rounded-md border border-border/70 p-2.5">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</legend>
      {allAllowed && (
        <label htmlFor={`${idPrefix}-all`} className="flex items-center gap-2 py-1 text-xs font-medium">
          <Checkbox id={`${idPrefix}-all`} checked={all} onCheckedChange={(c) => c === true && onChange([])} />
          All {label.toLowerCase()}
        </label>
      )}
      {!allAllowed && all && <p className="py-1 text-[11px] text-amber-700 dark:text-amber-400">Choose at least one — you cannot grant all {label.toLowerCase()}.</p>}
      <div className="max-h-36 overflow-y-auto">
        {items.length === 0 && <p className="py-1 text-[11px] text-muted-foreground">None registered.</p>}
        {items.map((item) => {
          const id = `${idPrefix}-${item.value}`;
          return (
            <label key={item.value} htmlFor={id} className="flex items-center gap-2 py-1 text-xs">
              <Checkbox
                id={id}
                checked={selected.includes(item.value)}
                onCheckedChange={(c) => onChange(c === true ? [...selected, item.value].sort() : selected.filter((v) => v !== item.value))}
              />
              {item.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Whether a scope choice can be submitted by this user (see ScopePicker). */
export function scopeChoiceValid(own: { countries: string[] | null; labs: string[] | null } | undefined, value: { countries: string[]; labs: string[] }): boolean {
  if (!own) return true;
  return (own.countries === null || value.countries.length > 0) && (own.labs === null || value.labs.length > 0);
}
