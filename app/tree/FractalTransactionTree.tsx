'use client'

import {
  hierarchy,
  select,
  tree as d3Tree,
  zoom,
  zoomIdentity,
  type ZoomBehavior,
} from 'd3'
import { ExternalLink, Heart, Maximize2, Minus, MousePointer2, Plus } from 'lucide-react'
import Link from 'next/link'
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { wocTxUrl } from '@/app/lib/explorer'
import type { BranchLike, MintTreeResponse, MinterOutput } from './types'

type Branch = {
  id: string
  txid: string
  outputIndex: number
  x1: number
  y1: number
  x2: number
  y2: number
  genesis: boolean
  live: boolean
}

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const TRUNK_LENGTH = 260
const FIRST_LEVEL_GAP = 142
const LEVEL_GAP_DECAY = 0.74
const LEAF_SPACING = 18

function shortTxid(txid: string): string {
  return `${txid.slice(0, 8)}…${txid.slice(-8)}`
}

function branchStroke(branch: Branch, highlighted: boolean, realtime: boolean): string {
  if (highlighted) return 'hsl(var(--primary))'
  if (realtime) return 'hsl(274 72% 52%)'
  if (branch.genesis) return 'hsl(var(--foreground))'
  if (branch.live) return 'hsl(151 58% 36%)'
  return 'hsl(8 66% 46%)'
}

function BranchDetailCard({
  branch,
  likes,
  pinned = false,
}: {
  branch: Branch
  likes: BranchLike[]
  pinned?: boolean
}) {
  return (
    <div
      className={`w-full border border-border bg-popover p-3 text-popover-foreground shadow-md sm:w-72 ${
        pinned ? '' : 'pointer-events-none'
      }`}
    >
      <div className="flex items-center gap-2 text-xs">
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-primary" />
        {pinned ? (
          <a
            href={wocTxUrl(branch.txid)}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 font-mono hover:underline"
            title={`${branch.txid}:${branch.outputIndex}`}
          >
            {shortTxid(branch.txid)}:{branch.outputIndex}
          </a>
        ) : (
          <span className="min-w-0 font-mono" title={`${branch.txid}:${branch.outputIndex}`}>
            {shortTxid(branch.txid)}:{branch.outputIndex}
          </span>
        )}
        {(branch.genesis || branch.live) && (
          <span className="ml-auto text-muted-foreground">
            {branch.genesis ? 'Genesis' : 'Live'}
          </span>
        )}
      </div>

      {likes.length > 0 ? (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          {likes.map((like) => (
            <div
              key={like.likeTxid}
              className="flex items-center gap-2 text-xs"
            >
              <Heart className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="shrink-0 text-muted-foreground">Spent to like</span>
              {pinned ? (
                <Link
                  href={`/tx/${like.postTxid}`}
                  className="min-w-0 font-mono hover:underline"
                  title={like.postTxid}
                >
                  {shortTxid(like.postTxid)}
                </Link>
              ) : (
                <span className="min-w-0 font-mono" title={like.postTxid}>
                  {shortTxid(like.postTxid)}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function buildFractal(tree: MintTreeResponse): { branches: Branch[]; bounds: Bounds } {
  const outputById = new Map(tree.outputs.map((output) => [output.id, output]))
  const root = outputById.get(tree.rootId)
  const branches: Branch[] = []

  if (!root) {
    return {
      branches,
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    }
  }

  const rootX = 0
  const rootY = -TRUNK_LENGTH
  branches.push({
    id: root.id,
    txid: root.txid,
    outputIndex: root.outputIndex,
    x1: 0,
    y1: 0,
    x2: rootX,
    y2: rootY,
    genesis: true,
    live: root.status === 'live',
  })

  const childrenFor = (output: MinterOutput): MinterOutput[] =>
    output.childIds
      .map((id) => outputById.get(id))
      .filter((child): child is MinterOutput => child !== undefined)
      .sort((a, b) => a.outputIndex - b.outputIndex)

  const hierarchyRoot = hierarchy(root, childrenFor)
  const tidyRoot = d3Tree<MinterOutput>()
    .nodeSize([LEAF_SPACING, 1])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.35))(hierarchyRoot)

  const rootOffsetX = tidyRoot.x
  const yByDepth = new Map<number, number>([[0, rootY]])
  for (let depth = 1; depth <= tidyRoot.height; depth += 1) {
    const previousY = yByDepth.get(depth - 1) ?? rootY
    yByDepth.set(
      depth,
      previousY - FIRST_LEVEL_GAP * LEVEL_GAP_DECAY ** (depth - 1)
    )
  }

  for (const node of tidyRoot.descendants()) {
    if (!node.parent) continue
    const parent = node.parent
    branches.push({
      id: node.data.id,
      txid: node.data.txid,
      outputIndex: node.data.outputIndex,
      x1: parent.x - rootOffsetX,
      y1: yByDepth.get(parent.depth) ?? rootY,
      x2: node.x - rootOffsetX,
      y2: yByDepth.get(node.depth) ?? rootY,
      genesis: false,
      live: node.data.status === 'live',
    })
  }

  const xs = branches.flatMap((branch) => [branch.x1, branch.x2])
  const ys = branches.flatMap((branch) => [branch.y1, branch.y2])
  return {
    branches,
    bounds: {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    },
  }
}

export default function FractalTransactionTree({
  tree,
  realtimeTxids,
}: {
  tree: MintTreeResponse
  realtimeTxids?: ReadonlySet<string>
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const treeGroupRef = useRef<SVGGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const hoverLeaveTimerRef = useRef<number | null>(null)
  const hoverPosRef = useRef({ x: 0, y: 0 })
  const [card, setCard] = useState<{
    branch: Branch
    x: number
    y: number
    pinned: boolean
  } | null>(null)
  const layout = useMemo(() => buildFractal(tree), [tree])
  const likesByBranchId = tree.likesByBranchId ?? {}

  const fitTree = useCallback(() => {
    const svg = svgRef.current
    const behavior = zoomRef.current
    if (!svg || !behavior) return

    const { width, height } = svg.getBoundingClientRect()
    if (width === 0 || height === 0) return

    const treeWidth = Math.max(layout.bounds.maxX - layout.bounds.minX, 1)
    const treeHeight = Math.max(layout.bounds.maxY - layout.bounds.minY, 1)
    const scale = Math.min((width * 0.78) / treeWidth, (height * 0.82) / treeHeight)
    const centerX = (layout.bounds.minX + layout.bounds.maxX) / 2
    const centerY = (layout.bounds.minY + layout.bounds.maxY) / 2
    const transform = zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-centerX, -centerY)

    select(svg).call(behavior.transform, transform)
  }, [layout.bounds])

  useLayoutEffect(() => {
    const svg = svgRef.current
    const group = treeGroupRef.current
    if (!svg || !group) return

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 32])
      .on('zoom', (event) => {
        group.setAttribute('transform', event.transform.toString())
      })

    const selection = select(svg)
    selection.call(behavior).on('dblclick.zoom', null)
    zoomRef.current = behavior

    const frame = requestAnimationFrame(fitTree)
    const resizeObserver = new ResizeObserver(fitTree)
    resizeObserver.observe(svg)

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      selection.on('.zoom', null)
      zoomRef.current = null
    }
  }, [fitTree])

  const syncHoverCardPosition = useCallback(() => {
    const cardElement = cardRef.current
    if (!cardElement) return
    const { x, y } = hoverPosRef.current
    cardElement.style.left = `${Math.min(Math.max(x + 16, 12), 640)}px`
    cardElement.style.top = `${Math.min(Math.max(y - 16, 12), 520)}px`
  }, [])

  const showHoverCard = useCallback(
    (branch: Branch, clientX: number, clientY: number) => {
      if (card?.pinned) return

      if (hoverLeaveTimerRef.current) {
        window.clearTimeout(hoverLeaveTimerRef.current)
        hoverLeaveTimerRef.current = null
      }

      const section = sectionRef.current
      if (!section) return
      const rect = section.getBoundingClientRect()
      hoverPosRef.current = {
        x: clientX - rect.left,
        y: clientY - rect.top,
      }

      if (card?.branch.id !== branch.id) {
        setCard({
          branch,
          x: hoverPosRef.current.x,
          y: hoverPosRef.current.y,
          pinned: false,
        })
      } else {
        syncHoverCardPosition()
      }
    },
    [card?.branch.id, card?.pinned, syncHoverCardPosition]
  )

  const scheduleHideHoverCard = useCallback(() => {
    if (hoverLeaveTimerRef.current) {
      window.clearTimeout(hoverLeaveTimerRef.current)
    }
    hoverLeaveTimerRef.current = window.setTimeout(() => {
      setCard((current) => (current?.pinned ? current : null))
      hoverLeaveTimerRef.current = null
    }, 100)
  }, [])

  useLayoutEffect(() => {
    if (card && !card.pinned) syncHoverCardPosition()
  }, [card, syncHoverCardPosition])

  useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current) {
        window.clearTimeout(hoverLeaveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!card?.pinned) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (cardRef.current?.contains(target)) return
      if (svgRef.current?.contains(target)) return
      setCard(null)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [card?.pinned])

  const zoomBy = (factor: number) => {
    const svg = svgRef.current
    const behavior = zoomRef.current
    if (svg && behavior) select(svg).call(behavior.scaleBy, factor)
  }

  const openBranchPopover = (branch: Branch, clientX: number, clientY: number) => {
    const section = sectionRef.current
    if (!section) return
    const rect = section.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    if (hoverLeaveTimerRef.current) {
      window.clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
    setCard((current) => {
      if (current?.branch.id === branch.id) {
        if (current.pinned) return null
        return {
          ...current,
          x: hoverPosRef.current.x,
          y: hoverPosRef.current.y,
          pinned: true,
        }
      }
      return { branch, x, y, pinned: true }
    })
  }

  const cardPosition = (x: number, y: number) => ({
    left: Math.min(Math.max(x + 16, 12), 640),
    top: Math.min(Math.max(y - 16, 12), 520),
  })

  return (
    <section
      ref={sectionRef}
      className="relative h-[calc(100svh-9.5rem)] min-h-[420px] overflow-hidden border-y border-border/70 bg-background lg:h-[calc(100dvh-12rem)] lg:min-h-[620px] lg:rounded-xl lg:border"
    >
      <svg
        ref={svgRef}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label="Interactive fractal tree of minter outputs"
        onClick={() => setCard(null)}
      >
        <g ref={treeGroupRef}>
          {layout.branches.map((branch) => {
            const isSelected = card?.pinned === true && card.branch.id === branch.id
            const highlighted = card?.branch.id === branch.id
            const realtime = realtimeTxids?.has(branch.txid) === true
            const likes = likesByBranchId[branch.id] ?? []
            const stroke = branchStroke(branch, highlighted, realtime)

            return (
              <g
                key={branch.id}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`${branch.genesis ? 'Genesis' : branch.live ? 'Live minter' : 'Spent minter'} output ${branch.txid}:${branch.outputIndex}${likes.length ? `, ${likes.length} linked post(s)` : ''}`}
                aria-pressed={isSelected}
                onClick={(event) => {
                  event.stopPropagation()
                  openBranchPopover(branch, event.clientX, event.clientY)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  const rect = (event.currentTarget as SVGGElement).getBoundingClientRect()
                  openBranchPopover(
                    branch,
                    rect.left + rect.width / 2,
                    rect.top + rect.height / 2
                  )
                }}
                onMouseEnter={(event) => showHoverCard(branch, event.clientX, event.clientY)}
                onMouseMove={(event) => showHoverCard(branch, event.clientX, event.clientY)}
                onMouseLeave={scheduleHideHoverCard}
              >
                <line
                  x1={branch.x1}
                  y1={branch.y1}
                  x2={branch.x2}
                  y2={branch.y2}
                  stroke="transparent"
                  strokeWidth={14}
                  vectorEffect="non-scaling-stroke"
                  className="[stroke-width:24px] sm:[stroke-width:14px]"
                />
                <line
                  x1={branch.x1}
                  y1={branch.y1}
                  x2={branch.x2}
                  y2={branch.y2}
                  stroke={stroke}
                  strokeWidth={
                    highlighted || realtime
                      ? 3
                      : branch.genesis
                        ? 2.4
                        : branch.live
                          ? 2
                          : 1.5
                  }
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className="transition-[stroke,stroke-width] duration-100"
                />
              </g>
            )
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] bg-background/92 px-3 py-2 text-[11px] ring-1 ring-border/70 sm:left-4 sm:top-4 sm:text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <MousePointer2 className="h-3.5 w-3.5 shrink-0" />
          <span className="sm:hidden">Tap a branch · pinch to zoom · drag to pan</span>
          <span className="hidden sm:inline">
            Hover a branch · click to pin · scroll to zoom · drag to pan
          </span>
        </div>
      </div>

      {card && (
        <div
          ref={cardRef}
          className={`absolute bottom-3 left-3 right-3 z-20 sm:bottom-auto sm:right-auto sm:left-[var(--card-left)] sm:top-[var(--card-top)] sm:-translate-y-full ${
            card.pinned ? '' : 'pointer-events-none'
          }`}
          style={
            {
              '--card-left': `${cardPosition(card.x, card.y).left}px`,
              '--card-top': `${cardPosition(card.x, card.y).top}px`,
            } as CSSProperties
          }
          role={card.pinned ? 'dialog' : undefined}
          aria-label={card.pinned ? 'Branch details' : undefined}
        >
          <BranchDetailCard
            branch={card.branch}
            likes={likesByBranchId[card.branch.id] ?? []}
            pinned={card.pinned}
          />
        </div>
      )}

      <div className="absolute bottom-3 left-3 flex overflow-hidden rounded-md border border-border bg-background shadow-sm sm:bottom-4 sm:left-4">
        <button
          type="button"
          className="grid h-11 w-11 place-items-center border-r border-border text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
          onClick={() => zoomBy(1.35)}
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="grid h-11 w-11 place-items-center border-r border-border text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
          onClick={() => zoomBy(1 / 1.35)}
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="grid h-11 w-11 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
          onClick={fitTree}
          aria-label="Fit tree"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-16 left-3 right-3 flex flex-wrap items-center justify-center gap-3 bg-background/92 px-2 py-2 text-[10px] text-muted-foreground ring-1 ring-border/70 sm:bottom-4 sm:left-auto sm:right-4 sm:gap-4 sm:px-3 sm:text-[11px]">
        {realtimeTxids && realtimeTxids.size > 0 ? (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 bg-purple-600" />
            New
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-emerald-600" />
          Live
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-5 bg-red-600" />
          Spent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-foreground" />
          Genesis
        </span>
      </div>
    </section>
  )
}
