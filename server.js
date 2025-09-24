const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const crypto = require('crypto');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Transaction Schema
const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  utrId: {
    type: String,
    default: null
  },
  amount: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    default: 'Payment'
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending'
  },
  upiId: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  paymentDate: {
    type: Date,
    default: null
  }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Generate random transaction ID
function generateTransactionId() {
  return 'TXN' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
}

// Generate random UTR ID
function generateUTRId() {
  return Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

// Routes

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create a new transaction
app.post('/api/transactions', async (req, res) => {
  try {
    const { amount, description, upiId } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    
    const transactionId = generateTransactionId();
    
    const newTransaction = new Transaction({
      transactionId,
      amount,
      description: description || 'Payment',
      upiId: upiId || '8618505915@fam'
    });
    
    await newTransaction.save();
    
    // Simulate payment processing after 3 seconds
    setTimeout(async () => {
      try {
        // 90% success rate
        const success = Math.random() > 0.1;
        
        if (success) {
          const utrId = generateUTRId();
          await Transaction.findOneAndUpdate(
            { transactionId },
            { 
              status: 'success', 
              utrId,
              paymentDate: new Date()
            }
          );
        } else {
          await Transaction.findOneAndUpdate(
            { transactionId },
            { status: 'failed' }
          );
        }
      } catch (err) {
        console.error('Error updating transaction status:', err);
      }
    }, 3000);
    
    res.status(201).json({
      message: 'Transaction initiated',
      transactionId,
      status: 'pending'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get transaction by ID
app.get('/api/transactions/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findOne({ transactionId: req.params.id });
    
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    res.json(transaction);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all transactions with filtering
app.get('/api/transactions', async (req, res) => {
  try {
    const { status, startDate, endDate, page = 1, limit = 10 } = req.query;
    const filter = {};
    
    if (status && status !== 'all') {
      filter.status = status;
    }
    
    if (startDate) {
      filter.date = { $gte: new Date(startDate) };
    }
    
    if (endDate) {
      if (filter.date) {
        filter.date.$lte = new Date(endDate);
      } else {
        filter.date = { $lte: new Date(endDate) };
      }
    }
    
    const skip = (page - 1) * limit;
    
    const transactions = await Transaction.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Transaction.countDocuments(filter);
    
    res.json({
      transactions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get transaction statistics
app.get('/api/stats', async (req, res) => {
  try {
    const totalTransactions = await Transaction.countDocuments();
    const successfulTransactions = await Transaction.countDocuments({ status: 'success' });
    const pendingTransactions = await Transaction.countDocuments({ status: 'pending' });
    const failedTransactions = await Transaction.countDocuments({ status: 'failed' });
    
    const totalAmount = await Transaction.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    // Get transactions per day for the last 7 days
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    
    const dailyTransactions = await Transaction.aggregate([
      { $match: { date: { $gte: lastWeek } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    res.json({
      totalTransactions,
      successfulTransactions,
      pendingTransactions,
      failedTransactions,
      totalAmount: totalAmount.length > 0 ? totalAmount[0].total : 0,
      dailyTransactions
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
