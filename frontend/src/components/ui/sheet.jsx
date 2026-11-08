import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
export const Sheet=Dialog.Root, SheetTrigger=Dialog.Trigger, SheetClose=Dialog.Close, SheetTitle=Dialog.Title, SheetDescription=Dialog.Description;
export function SheetContent({children}){return <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"/><Dialog.Content className="board-sheet fixed inset-y-0 left-0 z-50 flex w-[min(900px,96vw)] flex-col gap-6 overflow-y-auto border-r border-[var(--line-strong)] bg-[var(--bg)] p-6 shadow-2xl"><Dialog.Close className="absolute right-4 top-4 rounded p-2 focus-visible:outline-2" aria-label="Close task board"><X size={18}/></Dialog.Close>{children}</Dialog.Content></Dialog.Portal>}
