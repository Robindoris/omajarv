import React from 'react';
import {cn} from './button';
// Shared labelled control used by the sidebar search, project switcher and archive move.
export function Field({label,htmlFor,className,children}){return <label htmlFor={htmlFor} className={cn('flex min-w-0 flex-col gap-2 text-xs font-semibold text-[var(--muted)]',className)}>{label}{children}</label>;}
