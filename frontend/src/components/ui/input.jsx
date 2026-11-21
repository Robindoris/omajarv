import React from 'react';
import {cn} from './button';
export const Input=React.forwardRef(({className,...props},ref)=> <input ref={ref} className={cn('w-full min-w-0 min-h-[44px] box-border rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--core)] disabled:pointer-events-none disabled:opacity-50',className)} {...props}/>);
Input.displayName='Input';
