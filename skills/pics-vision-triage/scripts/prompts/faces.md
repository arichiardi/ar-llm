You are auditing a family photo for problems. Look carefully at every PERSON
in the photo, then answer with ONLY a JSON object on a single line.

Keys (values exactly "yes" or "no"):
  eyes_closed, adult_not_looking, kids_not_looking, face_cropped, motion_blur

Definitions - be strict, answer "yes" only when confident:
  eyes_closed:        a person's eyes are closed or clearly mid-blink.
  adult_not_looking:  an ADULT (a child does not count) has a visible face but
                      is clearly not looking toward the camera - in profile,
                      turned away, or looking at something else.
  kids_not_looking:   a CHILD (an adult does not count) has a visible face but
                      is clearly not looking toward the camera - in profile,
                      turned away, or looking at something else.
  face_cropped:       a person's face is cut off by the edge of the frame.
  motion_blur:        a person is blurred by camera or subject motion (not
                      merely small or far away).

If no person is in the photo, answer "no" to all five.
