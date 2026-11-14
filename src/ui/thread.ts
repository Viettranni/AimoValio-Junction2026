import type { CheckInEvent, ChoicesEvent, ProgressEvent } from '@/contracts';

export interface ChoiceAnswer {
  ids: string[];
  freeText?: string;
}

/** One entry in the chat column. Assistant prose stays short; structured content gets its own kind. */
export type ThreadItem =
  | { id: string; kind: 'greeting' }
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'choices'; event: ChoicesEvent; answer?: ChoiceAnswer }
  | { id: string; kind: 'progress'; events: ProgressEvent[] }
  | { id: string; kind: 'checkin'; event: CheckInEvent; answer?: string };

export type WidgetView = 'chat' | 'review' | 'receipt' | 'orders';

/** What the iframe asks the host script to do with its size. */
export type ResizeState = 'bubble' | 'chat' | 'expanded' | 'closed';
