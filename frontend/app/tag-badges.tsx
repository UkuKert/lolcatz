interface TagBadgesProps {
  tags?: string[];
}

export function TagBadges({ tags }: TagBadgesProps) {
  if (!tags?.length) return null;

  return (
    <div className="tags" aria-label="Tags">
      {tags.map(tag => (
        <a className="tag-badge" key={tag} href={`/search?tag=${encodeURIComponent(tag)}`}>
          {tag}
        </a>
      ))}
    </div>
  );
}
