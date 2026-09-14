import { NextResponse } from 'next/server.js';


export async function GET() {
  try {
    return NextResponse.json({
      status: 'ok'
    }, { status: 200 });
  } catch (err) {
    return NextResponse.json({
      status: 'error'
    }, { status: 500 });
  }
}

