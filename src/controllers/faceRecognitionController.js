// controllers/faceRecognitionController.js
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const FaceRecognitionLog = require('../models/FaceRecognitionLog');
const Holiday = require('../models/Holiday');
const Leave = require('../models/Leave');
const ComboOff = require('../models/ComboOff');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const {
    getISTDate,
    getISTMidnight,
    getISTStandardTime,
    getISTStandardCheckoutTime,
    formatISTTime,
    getCurrentWorkHours,
    getISTDay,
} = require('../utils/dateUtils');

const googleVisionService = require('../services/googleVisionService');

// ======================
// Helper Functions
// ======================

const validateBase64Image = (base64String) => {
    if (!base64String || typeof base64String !== 'string') {
        return false;
    }

    // Check if it's a valid base64 image string
    const base64Regex = /^data:image\/(jpeg|jpg|png|gif|bmp|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
    
    if (!base64Regex.test(base64String)) {
        // Also accept plain base64 without data URL
        const plainBase64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
        if (plainBase64Regex.test(base64String) && base64String.length > 100) {
            return true; // Valid plain base64
        }
        return false;
    }
    
    return true;
};

const extractBase64Data = (base64String) => {
    if (!base64String) return '';
    
    if (base64String.startsWith('data:image/')) {
        const parts = base64String.split(';base64,');
        if (parts.length === 2) {
            return parts[1];
        }
    }
    return base64String;
};

const formatImageForGoogleVision = (imageData) => {
    if (!imageData) return null;
    
    if (imageData.startsWith('data:image/')) {
        return imageData;
    }
    
    // Default to JPEG if no mime type specified
    return `data:image/jpeg;base64,${imageData}`;
};

// ======================
// Face Registration
// ======================

exports.registerFace = async (req, res) => {
    try {
        const { images } = req.body;
        const employeeId = req.user.id;

        if (!images || !Array.isArray(images) || images.length < 3) {
            return res.status(400).json({
                success: false,
                message: "At least 3 face images are required for registration"
            });
        }

        // Validate all images
        for (const [index, image] of images.entries()) {
            if (!validateBase64Image(image)) {
                return res.status(400).json({
                    success: false,
                    message: `Image ${index + 1} is not a valid base64 image`
                });
            }
        }

        // Check if user already has face registered
        const user = await User.findById(employeeId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (user.faceData && user.faceData.registered) {
            return res.status(400).json({
                success: false,
                message: "Face already registered. Use update-face to change."
            });
        }

        // Process all images with Google Vision
        const processedImages = [];
        let overallFeatures = null;
        let minConfidence = 1;
        let totalConfidence = 0;

        for (const [index, imageBase64] of images.entries()) {
            const formattedImage = formatImageForGoogleVision(imageBase64);
            const result = await googleVisionService.detectFaces(formattedImage);

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    message: `Image ${index + 1}: ${result.message}`
                });
            }

            // Store minimum confidence
            if (result.confidence < minConfidence) {
                minConfidence = result.confidence;
            }

            totalConfidence += result.confidence;

            processedImages.push({
                imageId: `img_${Date.now()}_${index}`,
                base64: extractBase64Data(imageBase64),
                features: result.face,
                confidence: result.confidence,
                boundingBox: result.boundingBox,
                detectionTime: new Date(),
            });

            // Use features from the highest confidence image as reference
            if (!overallFeatures || result.confidence > minConfidence) {
                overallFeatures = result.face;
            }
        }

        // Generate unique face ID
        const faceId = `face_${employeeId}_${Date.now()}`;
        const averageConfidence = totalConfidence / processedImages.length;

        // Save face data to user profile
        user.faceData = {
            faceId,
            registered: true,
            registeredAt: new Date(),
            lastUpdated: new Date(),
            images: processedImages,
            features: overallFeatures,
            confidence: minConfidence,
            verificationCount: 0,
            lastVerification: null,
            status: 'active',
            metadata: {
                imagesCount: processedImages.length,
                averageConfidence: parseFloat(averageConfidence.toFixed(2)),
                registrationMethod: 'google-vision'
            }
        };

        await user.save();

        // Log face registration
        await FaceRecognitionLog.create({
            employee: employeeId,
            type: "registration",
            timestamp: new Date(),
            success: true,
            confidence: minConfidence,
            method: "google-vision",
            details: `Registered with ${processedImages.length} images. Avg confidence: ${averageConfidence.toFixed(2)}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.status(200).json({
            success: true,
            message: "Face registered successfully",
            data: {
                faceId,
                registeredAt: user.faceData.registeredAt,
                imagesCount: processedImages.length,
                confidence: minConfidence,
                averageConfidence: parseFloat(averageConfidence.toFixed(2)),
                status: 'active'
            }
        });
    } catch (error) {
        console.error("Face registration error:", error);

        // Log failed registration
        if (req.user && req.user.id) {
            await FaceRecognitionLog.create({
                employee: req.user.id,
                type: "registration",
                timestamp: new Date(),
                success: false,
                error: error.message,
                method: "google-vision",
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
            });
        }

        res.status(500).json({
            success: false,
            message: "Face registration failed",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// ======================
// Face Check-In
// ======================

exports.faceCheckIn = async (req, res) => {
    try {
        const { image, deviceInfo = {}, latitude, longitude, address } = req.body;

        if (!image) {
            return res.status(400).json({
                success: false,
                message: "Face image is required for face recognition check-in"
            });
        }

        if (!validateBase64Image(image)) {
            return res.status(400).json({
                success: false,
                message: "Invalid image format. Please provide a valid base64 image."
            });
        }

        const today = getISTMidnight();
        const employeeId = req.user.id;

        // Check if user exists and has registered face data
        const user = await User.findById(employeeId).select("faceData isActive weekendType firstName lastName employeeId department");
        if (!user || !user.isActive) {
            return res.status(404).json({
                success: false,
                message: "User not found or inactive"
            });
        }

        if (!user.faceData || !user.faceData.registered) {
            return res.status(400).json({
                success: false,
                message: "Face not registered. Please register your face first"
            });
        }

        // Face verification using Google Vision
        const formattedImage = formatImageForGoogleVision(image);
        const verificationResult = await googleVisionService.detectFaces(formattedImage);

        if (!verificationResult.success) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-in",
                timestamp: new Date(),
                success: false,
                confidence: 0,
                method: "google-vision",
                error: verificationResult.message,
                ipAddress: req.ip,
                imageSize: image.length
            });

            return res.status(400).json({
                success: false,
                message: verificationResult.message
            });
        }

        // Compare with registered face
        const storedImage = user.faceData.images[0].base64;
        const registeredImage = formatImageForGoogleVision(storedImage);
        const comparison = await googleVisionService.compareFaces(registeredImage, formattedImage);

        const VERIFICATION_THRESHOLD = 0.75;
        const isVerified = comparison.success && comparison.similarity >= VERIFICATION_THRESHOLD;

        if (!isVerified) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-in",
                timestamp: new Date(),
                success: false,
                confidence: comparison.confidence || 0,
                similarity: comparison.similarity || 0,
                method: "google-vision",
                error: "Face verification failed - similarity below threshold",
                threshold: VERIFICATION_THRESHOLD,
                ipAddress: req.ip
            });

            return res.status(401).json({
                success: false,
                message: "Face verification failed. Please try again or use regular check-in",
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                threshold: VERIFICATION_THRESHOLD,
                required: "Please ensure good lighting and face the camera directly"
            });
        }

        // Weekend/Holiday/Combo Off check
        const weekendType = user.weekendType || "sunday";
        const day = getISTDay(today);
        const isWeekend =
            (weekendType === "sunday" && day === 0) ||
            (weekendType === "saturday_sunday" && (day === 0 || day === 6));

        // Check for holiday
        const startOfDay = getISTMidnight();
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(startOfDay.getDate() + 1);

        const holiday = await Holiday.findOne({
            date: { $gte: startOfDay, $lt: endOfDay },
            isActive: true,
        });

        if (isWeekend || holiday) {
            const comboOff = await ComboOff.findOne({
                employee: employeeId,
                date: today,
                status: "approved",
            });

            if (!comboOff) {
                const msg = holiday
                    ? `Cannot check in on holiday (${holiday.name}) without approved Combo Off`
                    : "Cannot check in on your weekly off day without approved Combo Off";

                await FaceRecognitionLog.create({
                    employee: employeeId,
                    type: "check-in",
                    timestamp: new Date(),
                    success: false,
                    confidence: comparison.confidence,
                    similarity: comparison.similarity,
                    method: "google-vision",
                    error: msg,
                    reason: isWeekend ? 'weekly_off' : 'holiday',
                    ipAddress: req.ip
                });

                return res.status(400).json({
                    success: false,
                    message: msg,
                });
            }
        }

        // Leave check
        const leave = await Leave.findOne({
            employee: employeeId,
            fromDate: { $lte: today },
            toDate: { $gte: today },
            status: "approved",
        });

        if (leave) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-in",
                timestamp: new Date(),
                success: false,
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                method: "google-vision",
                error: "Cannot check in while on approved leave",
                reason: 'on_leave',
                ipAddress: req.ip
            });

            return res.status(400).json({
                success: false,
                message: "Cannot check in, you are on approved leave",
            });
        }

        // Time restriction: no check-in after 6 PM IST
        const currentIST = moment().tz("Asia/Kolkata");
        const currentHour = currentIST.hour();

        if (currentHour >= 18) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-in",
                timestamp: new Date(),
                success: false,
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                method: "google-vision",
                error: "Check-in not allowed after 6 PM",
                reason: 'time_restriction',
                ipAddress: req.ip
            });

            return res.status(400).json({
                success: false,
                message: "Check-in not allowed after 6 PM",
            });
        }

        // Already checked-in?
        const existingAttendance = await Attendance.findOne({
            employee: employeeId,
            date: today,
        });

        if (existingAttendance && existingAttendance.checkIn?.time) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-in",
                timestamp: new Date(),
                success: false,
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                method: "google-vision",
                error: "Already checked in today",
                reason: 'duplicate_checkin',
                ipAddress: req.ip
            });

            return res.status(400).json({
                success: false,
                message: "Already checked in today",
                checkInTime: formatISTTime(existingAttendance.checkIn.time),
            });
        }

        // Record check-in
        const checkInTime = getISTDate();
        const standardTime = getISTStandardTime();
        const isLate = checkInTime > standardTime;
        const lateBy = isLate ? Math.round((checkInTime - standardTime) / (1000 * 60)) : 0;

        // Convert deviceInfo object to string
        const deviceInfoString = typeof deviceInfo === 'object'
            ? JSON.stringify(deviceInfo)
            : String(deviceInfo);

        let attendance;
        const faceCheckInData = {
            time: checkInTime,
            location: { latitude, longitude, address },
            deviceInfo: deviceInfoString,
            method: "face-recognition",
            faceVerified: true,
            faceData: {
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                verificationTime: new Date(),
                thresholdUsed: VERIFICATION_THRESHOLD
            }
        };

        if (existingAttendance) {
            existingAttendance.checkIn = faceCheckInData;
            existingAttendance.status = "present";
            existingAttendance.isLate = isLate;
            existingAttendance.lateBy = lateBy;
            attendance = await existingAttendance.save();
        } else {
            attendance = await Attendance.create({
                employee: employeeId,
                date: today,
                checkIn: faceCheckInData,
                status: "present",
                isLate,
                lateBy,
            });
        }

        // Update user verification count
        user.faceData.lastVerified = new Date();
        user.faceData.verificationCount = (user.faceData.verificationCount || 0) + 1;
        user.faceData.lastCheckIn = new Date();
        await user.save();

        // Mark Combo Off as earned
        if (isWeekend || holiday) {
            const comboOff = await ComboOff.findOne({
                employee: employeeId,
                date: today,
                status: "approved",
            });
            if (comboOff) {
                comboOff.status = "earned";
                comboOff.earnedOn = new Date();
                await comboOff.save();
            }
        }

        // Log successful face recognition event
        await FaceRecognitionLog.create({
            employee: employeeId,
            type: "check-in",
            timestamp: new Date(),
            success: true,
            confidence: comparison.confidence,
            similarity: comparison.similarity,
            method: "google-vision",
            deviceInfo: deviceInfoString,
            ipAddress: req.ip,
            attendanceId: attendance._id,
            details: `Checked in ${isLate ? lateBy + ' minutes late' : 'on time'}`
        });

        res.status(200).json({
            success: true,
            message: isLate
                ? `Face verified and checked in ${lateBy} minutes late`
                : "Face verified and checked in successfully",
            data: {
                checkInTime: formatISTTime(checkInTime),
                isLate,
                lateBy,
                method: "face-recognition",
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                verificationThreshold: VERIFICATION_THRESHOLD,
                user: {
                    employeeId: user.employeeId,
                    name: `${user.firstName} ${user.lastName}`,
                    department: user.department,
                    verificationCount: user.faceData.verificationCount
                },
                attendanceId: attendance._id
            }
        });
    } catch (error) {
        console.error("Face check-in error:", error);

        if (req.user && req.user.id) {
            await FaceRecognitionLog.create({
                employee: req.user.id,
                type: "check-in",
                timestamp: new Date(),
                success: false,
                error: error.message,
                method: "google-vision",
                ipAddress: req.ip
            });
        }

        res.status(500).json({
            success: false,
            message: "Face check-in failed",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// ======================
// Face Check-Out
// ======================

exports.faceCheckOut = async (req, res) => {
    try {
        const { image, deviceInfo = {}, latitude, longitude, address } = req.body;

        if (!image) {
            return res.status(400).json({
                success: false,
                message: "Face image is required for face recognition check-out"
            });
        }

        if (!validateBase64Image(image)) {
            return res.status(400).json({
                success: false,
                message: "Invalid image format. Please provide a valid base64 image."
            });
        }

        const today = getISTMidnight();
        const employeeId = req.user.id;

        // Check if user has registered face data
        const user = await User.findById(employeeId).select("faceData isActive firstName lastName employeeId");
        if (!user || !user.isActive) {
            return res.status(404).json({
                success: false,
                message: "User not found or inactive"
            });
        }

        if (!user.faceData || !user.faceData.registered) {
            return res.status(400).json({
                success: false,
                message: "Face not registered. Please register your face first or use regular check-out"
            });
        }

        // Face verification using Google Vision
        const formattedImage = formatImageForGoogleVision(image);
        const verificationResult = await googleVisionService.detectFaces(formattedImage);

        if (!verificationResult.success) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-out",
                timestamp: new Date(),
                success: false,
                confidence: 0,
                method: "google-vision",
                error: verificationResult.message,
                ipAddress: req.ip
            });

            return res.status(400).json({
                success: false,
                message: verificationResult.message
            });
        }

        // Compare with registered face
        const storedImage = user.faceData.images[0].base64;
        const registeredImage = formatImageForGoogleVision(storedImage);
        const comparison = await googleVisionService.compareFaces(registeredImage, formattedImage);

        const VERIFICATION_THRESHOLD = 0.75;
        const isVerified = comparison.success && comparison.similarity >= VERIFICATION_THRESHOLD;

        if (!isVerified) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-out",
                timestamp: new Date(),
                success: false,
                confidence: comparison.confidence || 0,
                similarity: comparison.similarity || 0,
                method: "google-vision",
                error: "Face verification failed - similarity below threshold",
                threshold: VERIFICATION_THRESHOLD,
                ipAddress: req.ip
            });

            return res.status(401).json({
                success: false,
                message: "Face verification failed. Please try again or use regular check-out",
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                threshold: VERIFICATION_THRESHOLD,
            });
        }

        // Check attendance record
        const attendance = await Attendance.findOne({
            employee: employeeId,
            date: today,
        });

        if (!attendance || !attendance.checkIn?.time) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-out",
                timestamp: new Date(),
                success: false,
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                method: "google-vision",
                error: "No check-in found for today",
                reason: 'no_checkin',
                ipAddress: req.ip
            });

            return res.status(400).json({
                success: false,
                message: "Please check in first",
            });
        }

        if (attendance.checkOut?.time) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-out",
                timestamp: new Date(),
                success: false,
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                method: "google-vision",
                error: "Already checked out today",
                reason: 'duplicate_checkout',
                ipAddress: req.ip
            });

            return res.status(400).json({
                success: false,
                message: "Already checked out today",
            });
        }

        let checkOutTime = getISTDate();

        // Prevent checkout before check-in
        const checkInIST = moment(attendance.checkIn.time).tz("Asia/Kolkata");
        const checkOutIST = moment(checkOutTime).tz("Asia/Kolkata");

        if (checkOutIST.isBefore(checkInIST)) {
            await FaceRecognitionLog.create({
                employee: employeeId,
                type: "check-out",
                timestamp: new Date(),
                success: false,
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                method: "google-vision",
                error: "Check-out time before check-in time",
                reason: 'invalid_time',
                ipAddress: req.ip
            });

            return res.status(400).json({
                success: false,
                message: "Check-out time cannot be before check-in time",
            });
        }

        // Cap at 23:59:59 IST
        const endOfDayIST = moment(today).tz("Asia/Kolkata").endOf("day");
        const missedCheckout = checkOutIST.isAfter(endOfDayIST);
        if (missedCheckout) {
            checkOutTime = endOfDayIST.toDate();
        }

        // Short attendance logic
        const standardCheckOutIST = moment(getISTStandardCheckoutTime()).tz("Asia/Kolkata");
        const finalCheckoutIST = moment(checkOutTime).tz("Asia/Kolkata");
        const isShort = finalCheckoutIST.isBefore(standardCheckOutIST);
        let shortByMinutes = 0;
        if (isShort) {
            shortByMinutes = standardCheckOutIST.diff(finalCheckoutIST, "minutes");
        }

        // Record check-out
        const faceCheckOutData = {
            time: checkOutTime,
            location: { latitude, longitude, address },
            deviceInfo: typeof deviceInfo === 'object' ? JSON.stringify(deviceInfo) : deviceInfo,
            method: "face-recognition",
            faceVerified: true,
            faceData: {
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                verificationTime: new Date(),
                thresholdUsed: VERIFICATION_THRESHOLD
            }
        };

        attendance.checkOut = faceCheckOutData;

        // Work hours calculation
        const workHours = parseFloat(
            finalCheckoutIST.diff(checkInIST, "minutes") / 60
        ).toFixed(2);

        attendance.workHours = parseFloat(workHours);
        attendance.isShortAttendance = isShort;
        attendance.shortByMinutes = shortByMinutes;
        if (missedCheckout) attendance.missedCheckout = true;

        await attendance.save();

        // Update user verification count
        user.faceData.lastVerified = new Date();
        user.faceData.verificationCount = (user.faceData.verificationCount || 0) + 1;
        user.faceData.lastCheckOut = new Date();
        await user.save();

        // Log the face recognition event
        await FaceRecognitionLog.create({
            employee: employeeId,
            type: "check-out",
            timestamp: new Date(),
            success: true,
            confidence: comparison.confidence,
            similarity: comparison.similarity,
            method: "google-vision",
            ipAddress: req.ip,
            attendanceId: attendance._id,
            details: `Checked out. Work hours: ${workHours}`
        });

        res.status(200).json({
            success: true,
            message: missedCheckout
                ? `Face verified and checked out at 23:59 (auto). Work hours: ${workHours}`
                : isShort
                    ? `Face verified and checked out – short attendance by ${shortByMinutes} min. Work hours: ${workHours}`
                    : `Face verified and checked out – full day. Work hours: ${workHours}`,
            data: {
                checkOutTime: formatISTTime(checkOutTime),
                workHours: parseFloat(workHours),
                isShortAttendance: isShort,
                shortByMinutes,
                missedCheckout,
                method: "face-recognition",
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                verificationThreshold: VERIFICATION_THRESHOLD,
                user: {
                    employeeId: user.employeeId,
                    name: `${user.firstName} ${user.lastName}`,
                    verificationCount: user.faceData.verificationCount
                },
                attendanceId: attendance._id
            }
        });
    } catch (error) {
        console.error("Face check-out error:", error);

        if (req.user && req.user.id) {
            await FaceRecognitionLog.create({
                employee: req.user.id,
                type: "check-out",
                timestamp: new Date(),
                success: false,
                error: error.message,
                method: "google-vision",
                ipAddress: req.ip
            });
        }

        res.status(500).json({
            success: false,
            message: "Face check-out failed",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// ======================
// Face Operations
// ======================

exports.updateFace = async (req, res) => {
    try {
        const { images } = req.body;
        const employeeId = req.user.id;

        if (!images || !Array.isArray(images) || images.length < 2) {
            return res.status(400).json({
                success: false,
                message: "At least 2 new face images are required for update"
            });
        }

        // Validate all images
        for (const [index, image] of images.entries()) {
            if (!validateBase64Image(image)) {
                return res.status(400).json({
                    success: false,
                    message: `Image ${index + 1} is not a valid base64 image`
                });
            }
        }

        const user = await User.findById(employeeId);
        if (!user.faceData || !user.faceData.registered) {
            return res.status(400).json({
                success: false,
                message: "Face not registered. Use register-face first."
            });
        }

        // Process new images
        const newImages = [];
        let minConfidence = 1;
        let totalConfidence = 0;

        for (const [index, imageBase64] of images.entries()) {
            const formattedImage = formatImageForGoogleVision(imageBase64);
            const result = await googleVisionService.detectFaces(formattedImage);

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    message: `Image ${index + 1}: ${result.message}`
                });
            }

            if (result.confidence < minConfidence) {
                minConfidence = result.confidence;
            }

            totalConfidence += result.confidence;

            newImages.push({
                imageId: `img_${Date.now()}_${index}`,
                base64: extractBase64Data(imageBase64),
                features: result.face,
                confidence: result.confidence,
                boundingBox: result.boundingBox,
                detectionTime: new Date(),
            });
        }

        // Add new images to existing ones (keep only last 10 images)
        const allImages = [...user.faceData.images, ...newImages];
        const keptImages = allImages.slice(-10);

        // Recalculate average confidence
        const totalConfidenceAll = keptImages.reduce((sum, img) => sum + img.confidence, 0);
        const averageConfidence = totalConfidenceAll / keptImages.length;

        user.faceData.images = keptImages;
        user.faceData.lastUpdated = new Date();
        user.faceData.confidence = Math.min(user.faceData.confidence || 1, minConfidence);
        user.faceData.metadata = {
            ...user.faceData.metadata,
            imagesCount: keptImages.length,
            averageConfidence: parseFloat(averageConfidence.toFixed(2)),
            lastUpdate: new Date()
        };

        await user.save();

        await FaceRecognitionLog.create({
            employee: employeeId,
            type: "update",
            timestamp: new Date(),
            success: true,
            confidence: minConfidence,
            method: "google-vision",
            details: `Updated with ${images.length} new images. Total images: ${keptImages.length}`,
            ipAddress: req.ip
        });

        res.status(200).json({
            success: true,
            message: "Face data updated successfully",
            data: {
                lastUpdated: user.faceData.lastUpdated,
                totalImages: keptImages.length,
                confidence: user.faceData.confidence,
                averageConfidence: user.faceData.metadata.averageConfidence,
                imagesAdded: images.length
            }
        });
    } catch (error) {
        console.error("Face update error:", error);
        res.status(500).json({
            success: false,
            message: "Face update failed",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

exports.deleteFace = async (req, res) => {
    try {
        const employeeId = req.params.employeeId ? req.params.employeeId : req.user.id;
        const { confirm } = req.body;
        const isAdminRequest = req.params.employeeId && req.params.employeeId !== req.user.id;

        // For self-deletion, require confirmation
        if (!isAdminRequest && confirm !== "DELETE") {
            return res.status(400).json({
                success: false,
                message: "Please confirm by sending 'DELETE' in the confirm field"
            });
        }

        const user = await User.findById(employeeId);
        if (!user.faceData || !user.faceData.registered) {
            return res.status(400).json({
                success: false,
                message: "Face not registered"
            });
        }

        // Store face data for logging
        const faceData = { ...user.faceData };

        // Remove face data from user profile
        user.faceData = undefined;
        await user.save();

        await FaceRecognitionLog.create({
            employee: employeeId,
            type: "deletion",
            timestamp: new Date(),
            success: true,
            method: "google-vision",
            details: `Face registration deleted${isAdminRequest ? ' by admin' : ''}. Had ${faceData.images?.length || 0} images.`,
            ipAddress: req.ip,
            deletedBy: isAdminRequest ? req.user.id : employeeId,
            deletedData: {
                imagesCount: faceData.images?.length || 0,
                registeredAt: faceData.registeredAt,
                verificationCount: faceData.verificationCount || 0
            }
        });

        res.status(200).json({
            success: true,
            message: "Face registration deleted successfully",
            data: {
                deletedAt: new Date(),
                deletedBy: isAdminRequest ? 'admin' : 'self',
                hadImages: faceData.images?.length || 0
            }
        });
    } catch (error) {
        console.error("Face deletion error:", error);
        res.status(500).json({
            success: false,
            message: "Face deletion failed",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

exports.getFaceStatus = async (req, res) => {
    try {
        const employeeId = req.user.id;
        const user = await User.findById(employeeId).select("faceData firstName lastName employeeId department");

        const faceData = user.faceData || {};

        const status = {
            registered: !!faceData.registered,
            registeredAt: faceData.registeredAt,
            lastUpdated: faceData.lastUpdated,
            lastVerified: faceData.lastVerified,
            verificationCount: faceData.verificationCount || 0,
            imagesCount: faceData.images ? faceData.images.length : 0,
            confidence: faceData.confidence,
            faceId: faceData.faceId,
            status: faceData.status || 'not_registered',
            metadata: faceData.metadata || {}
        };

        res.status(200).json({
            success: true,
            data: {
                status,
                user: {
                    id: user._id,
                    employeeId: user.employeeId,
                    name: `${user.firstName} ${user.lastName}`,
                    department: user.department
                }
            }
        });
    } catch (error) {
        console.error("Get face status error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to get face status",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

exports.verifyFaceStandalone = async (req, res) => {
    try {
        const { image } = req.body;
        const employeeId = req.user.id;

        if (!image) {
            return res.status(400).json({
                success: false,
                message: "Face image is required for verification"
            });
        }

        if (!validateBase64Image(image)) {
            return res.status(400).json({
                success: false,
                message: "Invalid image format. Please provide a valid base64 image."
            });
        }

        const user = await User.findById(employeeId).select("faceData firstName lastName employeeId");
        if (!user.faceData || !user.faceData.registered) {
            return res.status(400).json({
                success: false,
                message: "Face not registered"
            });
        }

        // Detect face in the provided image
        const formattedImage = formatImageForGoogleVision(image);
        const detectionResult = await googleVisionService.detectFaces(formattedImage);

        if (!detectionResult.success) {
            return res.status(400).json({
                success: false,
                message: detectionResult.message
            });
        }

        // Compare with registered face
        const storedImage = user.faceData.images[0].base64;
        const registeredImage = formatImageForGoogleVision(storedImage);
        const comparison = await googleVisionService.compareFaces(registeredImage, formattedImage);

        const VERIFICATION_THRESHOLD = 0.75;
        const isVerified = comparison.success && comparison.similarity >= VERIFICATION_THRESHOLD;

        // Update verification count if successful
        if (isVerified) {
            user.faceData.lastVerified = new Date();
            user.faceData.verificationCount = (user.faceData.verificationCount || 0) + 1;
            await user.save();
        }

        // Log the verification attempt
        await FaceRecognitionLog.create({
            employee: employeeId,
            type: "verification",
            timestamp: new Date(),
            success: isVerified,
            confidence: comparison.confidence,
            similarity: comparison.similarity,
            method: "google-vision",
            details: `Standalone verification ${isVerified ? 'successful' : 'failed'}`,
            ipAddress: req.ip,
            threshold: VERIFICATION_THRESHOLD
        });

        res.status(200).json({
            success: true,
            data: {
                verified: isVerified,
                confidence: comparison.confidence,
                similarity: comparison.similarity,
                threshold: VERIFICATION_THRESHOLD,
                message: isVerified
                    ? "Face verified successfully"
                    : "Face verification failed",
                user: {
                    employeeId: user.employeeId,
                    name: `${user.firstName} ${user.lastName}`,
                    lastVerified: user.faceData.lastVerified,
                    verificationCount: user.faceData.verificationCount
                }
            }
        });
    } catch (error) {
        console.error("Face verification error:", error);
        res.status(500).json({
            success: false,
            message: "Face verification failed",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// ======================
// Admin Functions
// ======================

exports.getFaceLogs = async (req, res) => {
    try {
        const {
            employeeId,
            startDate,
            endDate,
            type,
            success,
            method,
            limit = 100,
            page = 1
        } = req.query;

        const query = {};

        if (employeeId) {
            if (mongoose.Types.ObjectId.isValid(employeeId)) {
                query.employee = employeeId;
            } else {
                const user = await User.findOne({ employeeId }).select('_id');
                if (user) {
                    query.employee = user._id;
                } else {
                    return res.status(404).json({
                        success: false,
                        message: 'Employee not found'
                    });
                }
            }
        }

        if (type) query.type = type;
        if (success !== undefined) query.success = success === 'true';
        if (method) query.method = method;

        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [logs, total] = await Promise.all([
            FaceRecognitionLog.find(query)
                .populate('employee', 'firstName lastName employeeId email')
                .populate('deletedBy', 'firstName lastName employeeId')
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            FaceRecognitionLog.countDocuments(query)
        ]);

        // Add statistics
        const stats = {
            total,
            successful: await FaceRecognitionLog.countDocuments({ ...query, success: true }),
            failed: await FaceRecognitionLog.countDocuments({ ...query, success: false }),
            byType: await FaceRecognitionLog.aggregate([
                { $match: query },
                { $group: { _id: '$type', count: { $sum: 1 } } }
            ])
        };

        res.status(200).json({
            success: true,
            data: {
                logs,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                stats
            }
        });
    } catch (error) {
        console.error("Get face logs error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to get face logs",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

exports.getFaceRegistrations = async (req, res) => {
    try {
        const { status, department, limit = 50, page = 1 } = req.query;

        const query = {
            'faceData.registered': true,
            isActive: true
        };

        if (status) query['faceData.status'] = status;
        if (department) query.department = department;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [users, total] = await Promise.all([
            User.find(query)
                .select('firstName lastName employeeId email department faceData isActive')
                .sort({ 'faceData.registeredAt': -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            User.countDocuments(query)
        ]);

        const registrations = users.map(user => ({
            employee: {
                id: user._id,
                employeeId: user.employeeId,
                name: `${user.firstName} ${user.lastName}`,
                email: user.email,
                department: user.department
            },
            faceData: {
                registeredAt: user.faceData.registeredAt,
                lastUpdated: user.faceData.lastUpdated,
                lastVerified: user.faceData.lastVerified,
                verificationCount: user.faceData.verificationCount || 0,
                imagesCount: user.faceData.images?.length || 0,
                confidence: user.faceData.confidence,
                status: user.faceData.status || 'active',
                metadata: user.faceData.metadata || {}
            }
        }));

        // Statistics
        const stats = {
            totalRegistered: total,
            active: await User.countDocuments({
                ...query,
                'faceData.status': 'active'
            }),
            averageImages: registrations.length > 0
                ? registrations.reduce((sum, reg) => sum + reg.faceData.imagesCount, 0) / registrations.length
                : 0
        };

        res.status(200).json({
            success: true,
            data: {
                registrations,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                stats
            }
        });
    } catch (error) {
        console.error("Get face registrations error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to get face registrations",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

exports.getEmployeeFaceStatus = async (req, res) => {
    try {
        const { employeeId } = req.params;

        let user;
        if (mongoose.Types.ObjectId.isValid(employeeId)) {
            user = await User.findById(employeeId)
                .select('firstName lastName employeeId email department faceData isActive');
        } else {
            user = await User.findOne({ employeeId })
                .select('firstName lastName employeeId email department faceData isActive');
        }

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Get recent face logs for this employee
        const recentLogs = await FaceRecognitionLog.find({
            employee: user._id
        })
            .sort({ timestamp: -1 })
            .limit(10)
            .lean();

        const faceData = user.faceData || {};

        const status = {
            registered: !!faceData.registered,
            registeredAt: faceData.registeredAt,
            lastUpdated: faceData.lastUpdated,
            lastVerified: faceData.lastVerified,
            verificationCount: faceData.verificationCount || 0,
            imagesCount: faceData.images?.length || 0,
            confidence: faceData.confidence,
            faceId: faceData.faceId,
            status: faceData.status || 'not_registered',
            metadata: faceData.metadata || {}
        };

        res.status(200).json({
            success: true,
            data: {
                employee: {
                    id: user._id,
                    employeeId: user.employeeId,
                    name: `${user.firstName} ${user.lastName}`,
                    email: user.email,
                    department: user.department,
                    isActive: user.isActive
                },
                faceStatus: status,
                recentLogs,
                verificationStats: {
                    totalAttempts: recentLogs.length,
                    successful: recentLogs.filter(log => log.success).length,
                    recentActivity: recentLogs.filter(log =>
                        new Date(log.timestamp) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                    ).length
                }
            }
        });
    } catch (error) {
        console.error("Get employee face status error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to get employee face status",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

exports.bulkFaceRegistration = async (req, res) => {
    try {
        const { registrations } = req.body;

        if (!Array.isArray(registrations) || registrations.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Registrations array is required"
            });
        }

        const results = [];
        const errors = [];

        for (const [index, registration] of registrations.entries()) {
            try {
                const { employeeId, images } = registration;

                if (!employeeId || !images || !Array.isArray(images) || images.length < 3) {
                    errors.push({
                        index,
                        employeeId,
                        error: "Employee ID and at least 3 images are required"
                    });
                    continue;
                }

                // Find user
                let user;
                if (mongoose.Types.ObjectId.isValid(employeeId)) {
                    user = await User.findById(employeeId);
                } else {
                    user = await User.findOne({ employeeId });
                }

                if (!user) {
                    errors.push({
                        index,
                        employeeId,
                        error: "Employee not found"
                    });
                    continue;
                }

                if (!user.isActive) {
                    errors.push({
                        index,
                        employeeId,
                        error: "Employee is inactive"
                    });
                    continue;
                }

                if (user.faceData && user.faceData.registered) {
                    errors.push({
                        index,
                        employeeId,
                        error: "Face already registered"
                    });
                    continue;
                }

                // Validate images
                const validImages = [];
                for (const image of images) {
                    if (validateBase64Image(image)) {
                        validImages.push(image);
                    }
                }

                if (validImages.length < 3) {
                    errors.push({
                        index,
                        employeeId,
                        error: `Only ${validImages.length} valid images provided, need at least 3`
                    });
                    continue;
                }

                // Process images with Google Vision
                const processedImages = [];
                let minConfidence = 1;
                let totalConfidence = 0;

                for (const imageBase64 of validImages) {
                    const formattedImage = formatImageForGoogleVision(imageBase64);
                    const result = await googleVisionService.detectFaces(formattedImage);

                    if (!result.success) {
                        throw new Error(`Image processing failed: ${result.message}`);
                    }

                    if (result.confidence < minConfidence) {
                        minConfidence = result.confidence;
                    }

                    totalConfidence += result.confidence;

                    processedImages.push({
                        imageId: `img_${Date.now()}_${index}`,
                        base64: extractBase64Data(imageBase64),
                        features: result.face,
                        confidence: result.confidence,
                        boundingBox: result.boundingBox,
                        detectionTime: new Date(),
                    });
                }

                // Generate face ID
                const faceId = `face_${user._id}_${Date.now()}`;
                const averageConfidence = totalConfidence / processedImages.length;

                // Save face data
                user.faceData = {
                    faceId,
                    registered: true,
                    registeredAt: new Date(),
                    lastUpdated: new Date(),
                    images: processedImages,
                    confidence: minConfidence,
                    verificationCount: 0,
                    status: 'active',
                    metadata: {
                        imagesCount: processedImages.length,
                        averageConfidence: parseFloat(averageConfidence.toFixed(2)),
                        registrationMethod: 'bulk-admin',
                        registeredBy: req.user.id
                    }
                };

                await user.save();

                // Log registration
                await FaceRecognitionLog.create({
                    employee: user._id,
                    type: "registration",
                    timestamp: new Date(),
                    success: true,
                    confidence: minConfidence,
                    method: "google-vision",
                    details: `Bulk registered by admin. Images: ${processedImages.length}`,
                    ipAddress: req.ip,
                    registeredBy: req.user.id
                });

                results.push({
                    index,
                    employeeId: user.employeeId,
                    name: `${user.firstName} ${user.lastName}`,
                    success: true,
                    faceId,
                    imagesProcessed: processedImages.length,
                    confidence: minConfidence
                });

            } catch (error) {
                errors.push({
                    index,
                    employeeId: registration.employeeId,
                    error: error.message
                });
            }
        }

        res.status(200).json({
            success: true,
            data: {
                total: registrations.length,
                successful: results.length,
                failed: errors.length,
                results,
                errors: errors.length > 0 ? errors : undefined
            }
        });
    } catch (error) {
        console.error("Bulk face registration error:", error);
        res.status(500).json({
            success: false,
            message: "Bulk registration failed",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// ======================
// Testing Functions
// ======================

exports.testFaceDetection = async (req, res) => {
    try {
        const { image } = req.body;

        if (!image) {
            return res.status(400).json({
                success: false,
                message: "Image is required"
            });
        }

        if (!validateBase64Image(image)) {
            return res.status(400).json({
                success: false,
                message: "Invalid image format"
            });
        }

        const formattedImage = formatImageForGoogleVision(image);
        const result = await googleVisionService.detectFaces(formattedImage);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                ...result
            });
        }

        // Log test
        await FaceRecognitionLog.create({
            employee: req.user.id,
            type: "test",
            timestamp: new Date(),
            success: true,
            confidence: result.confidence,
            method: "google-vision",
            details: "Face detection test",
            ipAddress: req.ip
        });

        res.status(200).json({
            success: true,
            message: "Face detection test completed",
            data: {
                detected: true,
                confidence: result.confidence,
                features: {
                    landmarks: result.face.landmarks ? Object.keys(result.face.landmarks).length : 0,
                    emotions: result.face.emotions,
                    angles: result.face.angles,
                    bounds: result.face.bounds
                }
            }
        });
    } catch (error) {
        console.error("Face detection test error:", error);
        res.status(500).json({
            success: false,
            message: "Face detection test failed",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

exports.compareFaces = async (req, res) => {
    try {
        const { image1, image2 } = req.body;

        if (!image1 || !image2) {
            return res.status(400).json({
                success: false,
                message: 'Both images are required for comparison'
            });
        }

        console.log('\n📷 Processing images for comparison...');

        // Process images
        const processedImage1 = formatImageForGoogleVision(image1);
        const processedImage2 = formatImageForGoogleVision(image2);

        console.log('🔍 Starting face comparison...');
        const result = await googleVisionService.compareFaces(processedImage1, processedImage2);

        // If no faces detected, provide more guidance
        if (!result.success && !result.face1Detected && !result.face2Detected) {
            console.log('\n🤔 No faces detected. Suggestions:');
            console.log('   1. Ensure images contain clear, front-facing faces');
            console.log('   2. Check lighting - faces should be well-lit');
            console.log('   3. Avoid sunglasses, hats, or obstructions');
            console.log('   4. Try with different images');
        }

        res.status(200).json({
            success: true,
            data: {
                ...result,
                imageInfo: {
                    image1: {
                        size: image1.length,
                        estimatedKB: Math.round(image1.length * 3 / 4 / 1024)
                    },
                    image2: {
                        size: image2.length,
                        estimatedKB: Math.round(image2.length * 3 / 4 / 1024)
                    }
                }
            }
        });
    } catch (error) {
        console.error('Face comparison test error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error',
            suggestion: 'Please check that both images are valid and contain clear faces',
            debug: process.env.NODE_ENV === 'development' ? {
                error: error.message,
                stack: error.stack
            } : undefined
        });
    }
};