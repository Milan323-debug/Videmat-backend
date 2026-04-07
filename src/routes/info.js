const errorMap = {
  VIDEO_UNAVAILABLE: { status: 404, message: 'This video is unavailable or has been removed.' },
  VIDEO_PRIVATE:     { status: 403, message: 'This video is private.' },
  VIDEO_COPYRIGHT:   { status: 451, message: 'This video is blocked due to copyright.' },
  INVALID_URL:       { status: 400, message: 'Not a valid YouTube URL.' },
  RATE_LIMITED:      { status: 429, message: 'YouTube is rate limiting this server. Please try again in a few minutes.' },
  FETCH_FAILED:      { status: 502, message: 'Could not fetch video info. Try again.' },
  PARSE_FAILED:      { status: 500, message: 'Failed to parse video data.' },
};