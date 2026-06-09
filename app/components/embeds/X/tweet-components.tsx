import Image from "next/image"
import type { TwitterComponents } from "react-tweet"

export const tweetEmbedClassName = "vzn-tweet-embed w-full"

export const components: TwitterComponents = {
  AvatarImg: (props) => <Image {...props} alt={props.alt || "Tweet avatar"} />,
  MediaImg: (props) => <Image {...props} alt={props.alt || "Tweet media"} fill unoptimized />
}
