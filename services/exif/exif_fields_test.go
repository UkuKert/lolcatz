package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"testing"

	"github.com/rwcarlsen/goexif/exif"
)

func gpsFixture(t *testing.T, ref byte, coordinateDenominator, altitudeDenominator uint32) *exif.Exif {
	t.Helper()
	b := new(bytes.Buffer)
	put := func(v any) {
		if err := binary.Write(b, binary.LittleEndian, v); err != nil {
			t.Fatal(err)
		}
	}
	tag := func(id, kind uint16, count, value uint32) { put(id); put(kind); put(count); put(value) }
	b.WriteString("II")
	put(uint16(42))
	put(uint32(8))
	put(uint16(2))
	tag(0x010f, 2, 4, uint32('C')|uint32('a')<<8|uint32('m')<<16)
	tag(0x8825, 4, 1, 38)
	put(uint32(0))
	put(uint16(5))
	tag(1, 2, 2, uint32(ref))
	tag(2, 5, 3, 104)
	tag(3, 2, 2, uint32('E'))
	tag(4, 5, 3, 128)
	tag(6, 5, 1, 152)
	put(uint32(0))
	for _, n := range []uint32{59, 30, 0, 24, 45, 0} {
		put(n)
		put(coordinateDenominator)
	}
	put(uint32(10))
	put(altitudeDenominator)
	data, err := exif.Decode(bytes.NewReader(b.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestInvalidGPSPreservesCamera(t *testing.T) {
	for _, ref := range []byte{0, 'N'} {
		var fields exifFields
		fields.read(gpsFixture(t, ref, 0, 0))
		if fields.GPSLatitude != nil || fields.GPSLongitude != nil || fields.GPSAltitudeM != nil {
			t.Fatal("invalid GPS must remain absent")
		}
		if fields.CameraMake == nil || *fields.CameraMake != "Cam" {
			t.Fatal("valid camera data was lost")
		}
	}
}

func TestValidGPSWithInvalidAltitude(t *testing.T) {
	var fields exifFields
	fields.read(gpsFixture(t, 'N', 1, 0))
	if fields.GPSLatitude == nil || *fields.GPSLatitude != 59.5 || fields.GPSLongitude == nil || *fields.GPSLongitude != 24.75 {
		t.Fatalf("wrong GPS: %+v", fields)
	}
	if fields.GPSAltitudeM != nil {
		t.Fatal("zero denominator altitude must remain absent")
	}
}

func TestUploadedPhoto(t *testing.T) {
	path := os.Getenv("TEST_EXIF_PHOTO")
	if path == "" {
		t.Skip("TEST_EXIF_PHOTO is not set")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	data, err := exif.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	var fields exifFields
	fields.read(data)
	if fields.CameraModel == nil || *fields.CameraModel != "Pixel 10a" {
		t.Fatal("missing camera model")
	}
	if fields.GPSLatitude != nil || fields.GPSLongitude != nil {
		t.Fatal("photo's cleared GPS fields must remain absent")
	}
}
