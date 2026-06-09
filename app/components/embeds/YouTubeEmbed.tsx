import type React from 'react';

interface YouTubeEmbedProps {
  url: string;
}

const YouTubeEmbed: React.FC<YouTubeEmbedProps> = ({ url }) => {
  // Extract the video ID more reliably
  const getYouTubeVideoId = (url: string): string | null => {
    // Handle youtu.be links
    const shortUrlRegex = /youtu\.be\/([a-zA-Z0-9_-]+)/i;
    const shortMatch = url.match(shortUrlRegex);
    if (shortMatch) return shortMatch[1];
    
    // Handle youtube.com/watch?v= links
    const standardRegex = /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/i;
    const standardMatch = url.match(standardRegex);
    if (standardMatch) return standardMatch[1];
    
    // Handle youtube.com/embed/ links
    const embedRegex = /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/i;
    const embedMatch = url.match(embedRegex);
    if (embedMatch) return embedMatch[1];
    
    return null;
  };

  const videoId = getYouTubeVideoId(url);
  
  if (!videoId) {
    return (
      <div className="aspect-video bg-muted/20 rounded-md flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Invalid YouTube URL</p>
      </div>
    );
  }

  return (
    <div className="aspect-video w-full">
      <iframe
        src={`https://www.youtube.com/embed/${videoId}`}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full rounded-md"
      ></iframe>
    </div>
  );
};

export default YouTubeEmbed; 