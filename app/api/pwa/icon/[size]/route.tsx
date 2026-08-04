import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

const VALID_SIZES = new Set(['192', '512']);

// The KollegeApply chevron mark. The viewBox is squared around the artwork's
// real bounding box (x 22–670, y 11–631) so it renders centred — the source
// file's 725x632 box is not centred on the glyph itself.
const MARK_VIEWBOX = '-4 -29 700 700';
const MARK_PATH_1 =
  'M374.972 329.29L478.662 221.93L333.652 74.24H432.522L580.172 221.93L414.072 388.03L461.522 434.17L669.772 220.61L460.212 11H178.102L390.342 221.93L323.772 290.85';
const MARK_PATH_2 =
  'M323.602 290.81L200.382 418.31L359.892 567.24H270.252L113.382 411.71L279.482 246.93C265.852 232.87 237.292 204.75 234.662 200.79L22.4219 411.71L242.572 630.55H516.772L292.672 414.35L374.842 329.24';

export async function GET(
  _req: NextRequest,
  { params }: { params: { size: string } },
) {
  const dim = VALID_SIZES.has(params.size) ? Number(params.size) : 192;

  const radius = Math.round(dim * 0.22);
  // ~52% of the canvas keeps the mark inside the safe zone Android crops to
  // for the `purpose: maskable` entries in manifest.json.
  const markSize = Math.round(dim * 0.52);

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
        <svg
          width={markSize}
          height={markSize}
          viewBox={MARK_VIEWBOX}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d={MARK_PATH_1} fill="#F47062" stroke="#F47062" strokeWidth={2} />
          <path d={MARK_PATH_2} fill="#F47062" stroke="#F47062" strokeWidth={2} />
        </svg>
      </div>
    ),
    {
      width: dim,
      height: dim,
    },
  );
}
