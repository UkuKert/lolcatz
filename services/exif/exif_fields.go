package main

import (
	"math"
	"strings"
	"time"

	"github.com/rwcarlsen/goexif/exif"
)

// exifFields mirrors the image_exif columns. Every field is a pointer so a tag
// the camera never wrote lands in Postgres as NULL rather than as a zero that
// reads like a real measurement.
type exifFields struct {
	CapturedAt      *time.Time
	CameraMake      *string
	CameraModel     *string
	LensModel       *string
	Software        *string
	Width           *int
	Height          *int
	Orientation     *int
	ISO             *int
	FNumber         *float64
	ExposureSeconds *float64
	FocalLengthMM   *float64
	GPSLatitude     *float64
	GPSLongitude    *float64
	GPSAltitudeM    *float64
}

func (f *exifFields) read(data *exif.Exif) {
	f.CameraMake = exifString(data, exif.Make)
	f.CameraModel = exifString(data, exif.Model)
	f.LensModel = exifString(data, exif.LensModel)
	f.Software = exifString(data, exif.Software)
	f.Orientation = exifInteger(data, exif.Orientation)
	f.ISO = exifInteger(data, exif.ISOSpeedRatings)
	f.FNumber = exifNumber(data, exif.FNumber)
	f.ExposureSeconds = exifNumber(data, exif.ExposureTime)
	f.FocalLengthMM = exifNumber(data, exif.FocalLength)

	if taken, err := data.DateTime(); err == nil && !taken.IsZero() {
		f.CapturedAt = &taken
	}

	if latitude, longitude, ok := gpsCoordinates(data); ok {
		f.GPSLatitude = &latitude
		f.GPSLongitude = &longitude
		if altitude := exifNumber(data, exif.GPSAltitude); altitude != nil {
			// GPSAltitudeRef == 1 means the reading is below sea level.
			if ref := exifInteger(data, exif.GPSAltitudeRef); ref != nil && *ref == 1 {
				below := -*altitude
				altitude = &below
			}
			f.GPSAltitudeM = altitude
		}
	}
}

func exifString(data *exif.Exif, field exif.FieldName) *string {
	tag, err := data.Get(field)
	if err != nil {
		return nil
	}
	value, err := tag.StringVal()
	if err != nil {
		return nil
	}
	trimmed := strings.Trim(value, " \x00")
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func exifNumber(data *exif.Exif, field exif.FieldName) *float64 {
	tag, err := data.Get(field)
	if err != nil {
		return nil
	}
	if tag.Count == 0 {
		return nil
	}
	numerator, denominator, err := tag.Rat2(0)
	if err != nil || denominator == 0 {
		return nil
	}
	number := float64(numerator) / float64(denominator)
	return &number
}

func exifInteger(data *exif.Exif, field exif.FieldName) *int {
	tag, err := data.Get(field)
	if err != nil {
		return nil
	}
	if tag.Count == 0 {
		return nil
	}
	value, err := tag.Int(0)
	if err != nil {
		return nil
	}
	return &value
}

// Some exported photos keep GPS tags but zero their rationals and references.
// Such placeholders are not coordinates, including when LatLong reports no error.
func gpsCoordinates(data *exif.Exif) (float64, float64, bool) {
	latRef := exifString(data, exif.GPSLatitudeRef)
	lonRef := exifString(data, exif.GPSLongitudeRef)
	if latRef == nil || lonRef == nil || (*latRef != "N" && *latRef != "S") || (*lonRef != "E" && *lonRef != "W") {
		return 0, 0, false
	}
	for _, field := range []exif.FieldName{exif.GPSLatitude, exif.GPSLongitude} {
		tag, err := data.Get(field)
		if err != nil || tag.Count == 0 {
			return 0, 0, false
		}
	}
	lat, lon, err := data.LatLong()
	if err != nil || math.IsNaN(lat) || math.IsNaN(lon) || math.IsInf(lat, 0) || math.IsInf(lon, 0) || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
		return 0, 0, false
	}
	return lat, lon, true
}
