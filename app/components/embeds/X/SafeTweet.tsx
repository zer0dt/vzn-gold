'use client'

import { Component, type ErrorInfo, type ReactNode, useMemo } from 'react'
import {
  EmbeddedTweet,
  TweetNotFound,
  TweetSkeleton,
  useTweet,
  type TweetProps,
} from 'react-tweet'
import type { QuotedTweet, Tweet, TweetEntities } from 'react-tweet/api'

type TweetErrorBoundaryProps = {
  children: ReactNode
  fallback: ReactNode
  resetKey: string
}

type TweetErrorBoundaryState = {
  hasError: boolean
}

class TweetErrorBoundary extends Component<TweetErrorBoundaryProps, TweetErrorBoundaryState> {
  state: TweetErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): TweetErrorBoundaryState {
    return { hasError: true }
  }

  componentDidUpdate(prevProps: TweetErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('Unable to render tweet embed', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }

    return this.props.children
  }
}

type LooseTweetBase<T extends Tweet | QuotedTweet> = Omit<T, 'display_text_range' | 'entities'> & {
  display_text_range?: unknown
  entities?: Partial<TweetEntities> | null
  text?: unknown
}

const normalizeEntities = (entities?: Partial<TweetEntities> | null): TweetEntities => ({
  hashtags: Array.isArray(entities?.hashtags) ? entities.hashtags : [],
  urls: Array.isArray(entities?.urls) ? entities.urls : [],
  user_mentions: Array.isArray(entities?.user_mentions) ? entities.user_mentions : [],
  symbols: Array.isArray(entities?.symbols) ? entities.symbols : [],
  ...(Array.isArray(entities?.media) ? { media: entities.media } : {}),
})

const normalizeDisplayTextRange = (range: unknown, text: string): [number, number] => {
  if (
    Array.isArray(range) &&
    typeof range[0] === 'number' &&
    typeof range[1] === 'number'
  ) {
    return [range[0], range[1]]
  }

  return [0, Array.from(text).length]
}

const normalizeTweetBase = <T extends Tweet | QuotedTweet>(tweet: T): T => {
  const looseTweet = tweet as LooseTweetBase<T>
  const text = typeof looseTweet.text === 'string' ? looseTweet.text : ''

  return {
    ...tweet,
    text,
    display_text_range: normalizeDisplayTextRange(looseTweet.display_text_range, text),
    entities: normalizeEntities(looseTweet.entities),
  } as T
}

const normalizeTweet = (tweet: Tweet): Tweet => ({
  ...normalizeTweetBase(tweet),
  ...(tweet.quoted_tweet ? { quoted_tweet: normalizeTweetBase(tweet.quoted_tweet) } : {}),
})

export function SafeTweet({
  id,
  apiUrl,
  fallback = <TweetSkeleton />,
  components,
  fetchOptions,
  onError,
}: TweetProps) {
  const { data, error, isLoading } = useTweet(id, apiUrl, fetchOptions)
  const tweet = useMemo(() => (data ? normalizeTweet(data) : null), [data])
  const NotFound = components?.TweetNotFound ?? TweetNotFound
  const notFoundFallback = <NotFound error={onError ? onError(error) : error} />

  if (isLoading) {
    return fallback
  }

  if (error || !tweet) {
    return notFoundFallback
  }

  return (
    <TweetErrorBoundary resetKey={id ?? apiUrl ?? ''} fallback={notFoundFallback}>
      <EmbeddedTweet tweet={tweet} components={components} />
    </TweetErrorBoundary>
  )
}
