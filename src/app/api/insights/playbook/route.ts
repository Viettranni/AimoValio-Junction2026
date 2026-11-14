import { NextResponse } from 'next/server';
import { publicPlaybook } from '@/insights/engine';

export async function GET() {
  return NextResponse.json(publicPlaybook());
}
