import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

const VALID_SIZES = new Set(['192', '512']);

export async function GET(
  _req: NextRequest,
  { params }: { params: { size: string } },
) {
  const dim = VALID_SIZES.has(params.size) ? Number(params.size) : 192;

  const fontSize  = Math.round(dim * 0.38);
  const radius    = Math.round(dim * 0.22);

  return new ImageResponse(
    (
      <div
        style={{
          width: dim,
          height: dim,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d2455',
          borderRadius: radius,
        }}
      >
        {/* Subtle inner glow ring */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: radius,
            border: '2px solid rgba(255,255,255,0.08)',
          }}
        />
        {/* Monogram */}
        <span
          style={{
            color: '#ffffff',
            fontSize,
            fontWeight: 900,
            fontFamily: 'sans-serif',
            letterSpacing: '-2px',
            lineHeight: 1,
          }}
        >
          KA
        </span>
      </div>
    ),
    {
      width: dim,
      height: dim,
    },
  );
}
