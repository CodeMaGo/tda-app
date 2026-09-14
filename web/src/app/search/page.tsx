'use client';

import { redirect } from 'next/navigation';

// Search and the register are the same surface, so there is one screen, not two.
export default function SearchPage() {
  redirect('/decisions');
}
