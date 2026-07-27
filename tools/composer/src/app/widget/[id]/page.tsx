/**
 * Copyright 2026 Google LLC
 */
import {ClientWidgetPage} from './ClientWidgetPage';

export default async function WidgetPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <ClientWidgetPage id={id} />;
}
