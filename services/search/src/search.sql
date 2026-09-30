SELECT i.id, i.board,
		       COALESCE(NULLIF(BTRIM(i.title), ''), o.derived_title, '') AS title,
		       i.filename, i.content_type,
		       COALESCE(json_agg(json_build_object('name', t.tag, 'confidence', t.confidence) ORDER BY t.confidence DESC, t.tag) FILTER (WHERE t.tag IS NOT NULL), '[]') AS tags,
               COALESCE((SELECT json_agg(json_build_object(
                   'id', a.id, 'label', a.label, 'confidence', a.confidence,
                   'bbox', json_build_array(a.x1, a.y1, a.x2, a.y2)) ORDER BY a.id)
                   FROM image_annotations a WHERE a.image_id = i.id), '[]') AS annotations,
		       i.uploaded_at,
               (SELECT COUNT(*) FROM comments c WHERE c.image_id = i.id) AS comment_count
		FROM images i
		LEFT JOIN (SELECT image_id, label AS tag, MAX(confidence) AS confidence FROM image_annotations GROUP BY image_id, label) t ON t.image_id = i.id
		LEFT JOIN image_ocr  o ON o.image_id = i.id
